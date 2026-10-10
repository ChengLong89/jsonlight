use std::path::PathBuf;

/// A file passed to the app on launch via "Open with" (Windows passes paths as CLI args).
#[derive(serde::Serialize, Clone)]
struct OpenWithFile {
  path: String,
  mode: &'static str,
}

/// Files the app was launched with. The frontend pulls these once it has loaded;
/// emitting an event from `setup` would fire before the page registers a listener.
struct LaunchFiles(Vec<OpenWithFile>);

fn launch_file(path: PathBuf) -> OpenWithFile {
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

  OpenWithFile {
    path: path.to_string_lossy().into_owned(),
    mode,
  }
}

#[tauri::command]
fn get_open_with_files(files: tauri::State<LaunchFiles>) -> Vec<OpenWithFile> {
  files.0.clone()
}

/// Returns the raw bytes of launch file `index`. A binary response skips the
/// JSON encoding of regular command results, which is slow for large files.
/// Only files the app was launched with can be read.
#[tauri::command]
fn read_open_with_file(
  index: usize,
  files: tauri::State<LaunchFiles>,
) -> Result<tauri::ipc::Response, String> {
  let file = files.0.get(index).ok_or("no such launch file")?;
  let bytes = std::fs::read(&file.path).map_err(|err| err.to_string())?;
  Ok(tauri::ipc::Response::new(bytes))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let launch_files: Vec<OpenWithFile> = std::env::args_os()
    .skip(1)
    .map(PathBuf::from)
    .map(launch_file)
    .collect();

  tauri::Builder::default()
    .manage(LaunchFiles(launch_files))
    .invoke_handler(tauri::generate_handler![get_open_with_files, read_open_with_file])
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
