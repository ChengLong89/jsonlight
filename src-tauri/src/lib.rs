use std::path::PathBuf;

/// A file passed to the app on launch via "Open with" (Windows passes paths as CLI args).
#[derive(serde::Serialize, Clone)]
struct OpenWithFile {
  path: String,
  mode: &'static str,
  content: Option<String>,
  error: Option<String>,
}

/// Files the app was launched with. The frontend pulls these once it has loaded;
/// emitting an event from `setup` would fire before the page registers a listener.
struct LaunchFiles(Vec<OpenWithFile>);

fn load_launch_file(path: PathBuf) -> OpenWithFile {
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

  let (content, error) = match std::fs::read_to_string(&path) {
    Ok(content) => (Some(content), None),
    Err(err) => (None, Some(err.to_string())),
  };

  OpenWithFile {
    path: path.to_string_lossy().into_owned(),
    mode,
    content,
    error,
  }
}

#[tauri::command]
fn get_open_with_files(files: tauri::State<LaunchFiles>) -> Vec<OpenWithFile> {
  files.0.clone()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let launch_files: Vec<OpenWithFile> = std::env::args_os()
    .skip(1)
    .map(PathBuf::from)
    .map(load_launch_file)
    .collect();

  tauri::Builder::default()
    .manage(LaunchFiles(launch_files))
    .invoke_handler(tauri::generate_handler![get_open_with_files])
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
