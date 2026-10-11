mod large_json;

use std::path::PathBuf;
use std::sync::Mutex;

use large_json::{LargeDocs, OpenOut, PageOut};
use tauri_plugin_dialog::DialogExt;

/// A file the user opened: passed on launch via "Open with" (Windows passes
/// paths as CLI args) or picked in the native file dialog.
#[derive(serde::Serialize, Clone)]
struct OpenedFile {
  /// Index used by the page to read this file
  index: usize,
  path: String,
  mode: &'static str,
  size: u64,
}

/// Files the user opened. The page can only read files listed here.
/// The first `launch_count` are the launch files, which the frontend pulls
/// once it has loaded (an event emitted from `setup` would fire before the
/// page registers a listener).
struct OpenedFiles {
  files: Mutex<Vec<OpenedFile>>,
  launch_count: usize,
}

impl OpenedFiles {
  fn add(&self, path: PathBuf) -> OpenedFile {
    let mut files = self.files.lock().unwrap();
    let file = opened_file(files.len(), path);
    files.push(file.clone());
    file
  }

  fn path(&self, index: usize) -> Result<String, String> {
    let files = self.files.lock().unwrap();
    files.get(index).map(|file| file.path.clone()).ok_or_else(|| "no such file".into())
  }
}

fn opened_file(index: usize, path: PathBuf) -> OpenedFile {
  // Explorer passes absolute paths; make CLI-relative paths absolute too
  let path = if path.is_absolute() {
    path
  } else {
    std::env::current_dir().map(|cwd| cwd.join(&path)).unwrap_or(path)
  };

  let extension = path.extension().and_then(|ext| ext.to_str()).unwrap_or("");
  let mode = match extension.to_lowercase().as_str() {
    "jsonl" => "jsonl",
    _ => "json", // .json, .geojson and anything else
  };
  let size = std::fs::metadata(&path).map(|meta| meta.len()).unwrap_or(0);

  OpenedFile {
    index,
    path: path.to_string_lossy().into_owned(),
    mode,
    size,
  }
}

#[tauri::command]
fn get_open_with_files(files: tauri::State<OpenedFiles>) -> Vec<OpenedFile> {
  files.files.lock().unwrap()[..files.launch_count].to_vec()
}

/// Shows the native open dialog (the page's <input type="file"> cannot
/// reveal a file's path, which large files need). None if cancelled.
#[tauri::command]
async fn pick_file(
  app: tauri::AppHandle,
  files: tauri::State<'_, OpenedFiles>,
) -> Result<Option<OpenedFile>, String> {
  let picked = app
    .dialog()
    .file()
    .add_filter("JSON", &["json", "jsonl", "geojson"])
    .blocking_pick_file();
  match picked {
    None => Ok(None),
    Some(path) => Ok(Some(files.add(path.into_path().map_err(|err| err.to_string())?))),
  }
}

/// Returns the raw bytes of opened file `index`. A binary response skips the
/// JSON encoding of regular command results, which is slow for large files.
#[tauri::command]
fn read_open_with_file(
  index: usize,
  files: tauri::State<OpenedFiles>,
) -> Result<tauri::ipc::Response, String> {
  let bytes = std::fs::read(files.path(index)?).map_err(|err| err.to_string())?;
  Ok(tauri::ipc::Response::new(bytes))
}

/// Opens opened file `index` as a large JSON document (see large_json.rs)
#[tauri::command]
async fn large_json_open(
  index: usize,
  files: tauri::State<'_, OpenedFiles>,
  docs: tauri::State<'_, LargeDocs>,
) -> Result<OpenOut, String> {
  let path = files.path(index)?;
  docs.open(&path)
}

/// Children [from, to) of the container at byte `start` of document `doc`
#[tauri::command]
async fn large_json_children(
  doc: u32,
  start: usize,
  from: usize,
  to: usize,
  docs: tauri::State<'_, LargeDocs>,
) -> Result<PageOut, String> {
  docs.get(doc)?.children(start, from, to)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let launch_files: Vec<OpenedFile> = std::env::args_os()
    .skip(1)
    .map(PathBuf::from)
    .enumerate()
    .map(|(index, path)| opened_file(index, path))
    .collect();

  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .manage(OpenedFiles {
      launch_count: launch_files.len(),
      files: Mutex::new(launch_files),
    })
    .manage(LargeDocs::default())
    .invoke_handler(tauri::generate_handler![
      get_open_with_files,
      pick_file,
      read_open_with_file,
      large_json_open,
      large_json_children
    ])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
