//! Lazy viewer backend for JSON files too large to load in the page.
//!
//! The file is memory-mapped, validated once, and never parsed into a tree.
//! Containers are addressed by the byte offset of their opening bracket;
//! expanding one scans just its byte range to find the positions of its
//! direct children, which are cached and served a page at a time.

use std::collections::HashMap;
use std::fs::File;
use std::sync::{Arc, Mutex};

use memmap2::Mmap;
use serde::Serialize;

/// String values longer than this (in bytes, as in the file) are sent as a preview
const STRING_LIMIT: usize = 16 * 1024 * 1024;
const STRING_PREVIEW: usize = 1024 * 1024;
/// Cached child positions are dropped once this many are held (32 bytes each)
const CACHE_LIMIT: usize = 16 * 1024 * 1024;

/// Position of one child of a container: key (objects only) and value byte ranges
#[derive(Clone, Copy)]
struct ChildPos {
  key_start: usize,
  key_end: usize,
  value_start: usize,
  value_end: usize,
}

pub struct Doc {
  id: u32,
  data: Mmap,
  children: Mutex<ChildCache>,
}

#[derive(Default)]
struct ChildCache {
  by_start: HashMap<usize, Arc<Vec<ChildPos>>>,
  held: usize,
}

/// The open document (one at a time; opening another releases the previous map)
#[derive(Default)]
pub struct LargeDocs {
  doc: Mutex<Option<Arc<Doc>>>,
  next_id: Mutex<u32>,
}

/// A value as shown in the page
#[derive(Serialize)]
pub struct NodeOut {
  /// "object", "array", "string", "number", "boolean" or "null"
  kind: &'static str,
  /// Byte offset of the value; identifies a container in `children` requests
  start: usize,
  /// Containers: whether they have no children
  empty: bool,
  /// Scalars: the value as JSON text (a preview for very long strings)
  raw: Option<String>,
  /// Strings sent as a preview: full length in bytes
  truncated_bytes: Option<usize>,
}

#[derive(Serialize)]
pub struct OpenOut {
  doc: u32,
  root: NodeOut,
}

#[derive(Serialize)]
pub struct ChildOut {
  key: Option<String>,
  node: NodeOut,
}

#[derive(Serialize)]
pub struct PageOut {
  total: usize,
  children: Vec<ChildOut>,
}

impl LargeDocs {
  /// Maps and validates the file, makes it the open document and describes its root
  pub fn open(&self, path: &str) -> Result<OpenOut, String> {
    // Release the previous document before mapping the next one
    *self.doc.lock().unwrap() = None;

    let file = File::open(path).map_err(|err| err.to_string())?;
    // Safety: the map is read-only; if another program truncates the file
    // while it is open, reads may fault, as with any memory-mapped viewer.
    let data = unsafe { Mmap::map(&file) }.map_err(|err| err.to_string())?;

    let body_start = if data.starts_with(b"\xEF\xBB\xBF") { 3 } else { 0 };
    validate(&data[body_start..])?;

    let root_start = skip_ws(&data, body_start);
    let root_end = skip_value(&data, root_start)?;
    let root = describe(&data, root_start, root_end)?;

    let id = {
      let mut next_id = self.next_id.lock().unwrap();
      *next_id += 1;
      *next_id
    };
    *self.doc.lock().unwrap() = Some(Arc::new(Doc {
      id,
      data,
      children: Mutex::new(ChildCache::default()),
    }));
    Ok(OpenOut { doc: id, root })
  }

  pub fn get(&self, id: u32) -> Result<Arc<Doc>, String> {
    match &*self.doc.lock().unwrap() {
      Some(doc) if doc.id == id => Ok(doc.clone()),
      _ => Err("This document is no longer open".into()),
    }
  }
}

impl Doc {
  /// Children [from, to) of the container starting at byte `start`
  pub fn children(&self, start: usize, from: usize, to: usize) -> Result<PageOut, String> {
    let positions = self.child_positions(start)?;
    let data = &self.data[..];
    let is_object = data[start] == b'{';
    let to = to.min(positions.len());
    let from = from.min(to);

    let mut children = Vec::with_capacity(to - from);
    for pos in &positions[from..to] {
      let key = if is_object {
        Some(decode_string(&data[pos.key_start..pos.key_end])?)
      } else {
        None
      };
      children.push(ChildOut {
        key,
        node: describe(data, pos.value_start, pos.value_end)?,
      });
    }
    Ok(PageOut { total: positions.len(), children })
  }

  fn child_positions(&self, start: usize) -> Result<Arc<Vec<ChildPos>>, String> {
    if let Some(positions) = self.children.lock().unwrap().by_start.get(&start) {
      return Ok(positions.clone());
    }
    // Scan without holding the lock; a concurrent duplicate scan is harmless
    let positions = Arc::new(list_children(&self.data, start)?);
    let mut cache = self.children.lock().unwrap();
    if cache.held + positions.len() > CACHE_LIMIT {
      cache.by_start.clear();
      cache.held = 0;
    }
    cache.held += positions.len();
    cache.by_start.insert(start, positions.clone());
    Ok(positions)
  }
}

/// Checks the whole document is valid JSON, reporting line and column if not
fn validate(data: &[u8]) -> Result<(), String> {
  match serde_json::from_slice::<serde::de::IgnoredAny>(data) {
    Ok(_) => Ok(()),
    // serde_json limits nesting to 128 levels; the scanner below has no such
    // limit, so deeper documents are opened unvalidated rather than refused
    Err(err) if err.to_string().contains("recursion limit") => Ok(()),
    Err(err) => Err(err.to_string()),
  }
}

fn describe(data: &[u8], start: usize, end: usize) -> Result<NodeOut, String> {
  let first = *data.get(start).ok_or_else(|| unexpected_end(start))?;
  let (kind, raw, truncated_bytes) = match first {
    b'{' | b'[' => {
      let kind = if first == b'{' { "object" } else { "array" };
      let after = skip_ws(data, start + 1);
      return Ok(NodeOut {
        kind,
        start,
        empty: after < end && data[after] == if first == b'{' { b'}' } else { b']' },
        raw: None,
        truncated_bytes: None,
      });
    }
    b'"' if end - start > STRING_LIMIT => {
      ("string", Some(string_preview(&data[start..end])?), Some(end - start))
    }
    b'"' => ("string", Some(utf8(&data[start..end])), None),
    b't' | b'f' => ("boolean", Some(utf8(&data[start..end])), None),
    b'n' => ("null", Some(utf8(&data[start..end])), None),
    _ => ("number", Some(utf8(&data[start..end])), None),
  };
  Ok(NodeOut { kind, start, empty: true, raw, truncated_bytes })
}

/// JSON text of a string holding the first ~STRING_PREVIEW bytes of `quoted`
fn string_preview(quoted: &[u8]) -> Result<String, String> {
  // Cut on an escape-sequence boundary...
  let mut i = 1;
  let mut cut = 1;
  while i < quoted.len() - 1 && i <= STRING_PREVIEW {
    cut = i;
    i += if quoted[i] == b'\\' { if quoted.get(i + 1) == Some(&b'u') { 6 } else { 2 } } else { 1 };
  }
  // ...and a UTF-8 character boundary
  while cut > 1 && (quoted[cut] & 0b1100_0000) == 0b1000_0000 {
    cut -= 1;
  }
  let mut text = Vec::with_capacity(cut + 1);
  text.extend_from_slice(&quoted[..cut]);
  text.push(b'"');
  let preview: String = serde_json::from_slice(&text).map_err(|err| err.to_string())?;
  serde_json::to_string(&preview).map_err(|err| err.to_string())
}

fn decode_string(quoted: &[u8]) -> Result<String, String> {
  serde_json::from_slice(quoted).map_err(|err| err.to_string())
}

fn utf8(bytes: &[u8]) -> String {
  String::from_utf8_lossy(bytes).into_owned()
}

fn unexpected_end(at: usize) -> String {
  format!("Unexpected end of JSON at byte {at}")
}

fn unexpected(data: &[u8], at: usize, expected: &str) -> String {
  match data.get(at) {
    Some(&b) => format!("Expected {expected} at byte {at}, found {:?}", b as char),
    None => unexpected_end(at),
  }
}

fn skip_ws(data: &[u8], mut i: usize) -> usize {
  while i < data.len() && matches!(data[i], b' ' | b'\t' | b'\n' | b'\r') {
    i += 1;
  }
  i
}

/// `data[i]` is the opening quote; returns the index after the closing quote
fn skip_string(data: &[u8], i: usize) -> Result<usize, String> {
  let mut j = i + 1;
  while j < data.len() {
    match memchr::memchr2(b'"', b'\\', &data[j..]) {
      Some(k) if data[j + k] == b'\\' => j += k + 2,
      Some(k) => return Ok(j + k + 1),
      None => break,
    }
  }
  Err(format!("Unterminated string starting at byte {i}"))
}

/// `data[i]` is the first byte of a value; returns the index after it
fn skip_value(data: &[u8], i: usize) -> Result<usize, String> {
  match data.get(i) {
    None => Err(unexpected_end(i)),
    Some(b'"') => skip_string(data, i),
    Some(b'{' | b'[') => skip_container(data, i),
    Some(_) => {
      let mut j = i;
      while j < data.len() && !matches!(data[j], b',' | b'}' | b']' | b' ' | b'\t' | b'\n' | b'\r') {
        j += 1;
      }
      if j == i { Err(unexpected(data, i, "a value")) } else { Ok(j) }
    }
  }
}

/// Finds the matching close bracket iteratively, so nesting depth is unlimited
fn skip_container(data: &[u8], i: usize) -> Result<usize, String> {
  let mut depth = 0usize;
  let mut j = i;
  while j < data.len() {
    match data[j] {
      b'"' => {
        j = skip_string(data, j)?;
        continue;
      }
      b'{' | b'[' => depth += 1,
      b'}' | b']' => {
        depth -= 1;
        if depth == 0 {
          return Ok(j + 1);
        }
      }
      _ => {}
    }
    j += 1;
  }
  Err(format!("Unterminated {} starting at byte {i}", if data[i] == b'{' { "object" } else { "array" }))
}

/// Positions of the direct children of the container starting at `start`
fn list_children(data: &[u8], start: usize) -> Result<Vec<ChildPos>, String> {
  let is_object = match data.get(start) {
    Some(b'{') => true,
    Some(b'[') => false,
    _ => return Err(unexpected(data, start, "an object or array")),
  };
  let close = if is_object { b'}' } else { b']' };
  let mut children = Vec::new();

  let mut i = skip_ws(data, start + 1);
  if data.get(i) == Some(&close) {
    return Ok(children);
  }
  loop {
    let (key_start, key_end) = if is_object {
      if data.get(i) != Some(&b'"') {
        return Err(unexpected(data, i, "a key"));
      }
      let key_end = skip_string(data, i)?;
      let key_start = i;
      i = skip_ws(data, key_end);
      if data.get(i) != Some(&b':') {
        return Err(unexpected(data, i, "':'"));
      }
      i = skip_ws(data, i + 1);
      (key_start, key_end)
    } else {
      (0, 0)
    };

    let value_start = i;
    let value_end = skip_value(data, i)?;
    children.push(ChildPos { key_start, key_end, value_start, value_end });

    i = skip_ws(data, value_end);
    match data.get(i) {
      Some(b',') => i = skip_ws(data, i + 1),
      Some(&b) if b == close => return Ok(children),
      _ => return Err(unexpected(data, i, "',' or a closing bracket")),
    }
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  fn kids(json: &str) -> Vec<(String, String)> {
    let data = json.as_bytes();
    let start = skip_ws(data, 0);
    list_children(data, start)
      .unwrap()
      .iter()
      .map(|p| (json[p.key_start..p.key_end].to_string(), json[p.value_start..p.value_end].to_string()))
      .collect()
  }

  #[test]
  fn lists_object_children() {
    let got = kids(r#" { "a" : 1 , "b\"}" : {"x": [1, "]", {}]}, "c": "s\\", "d": null } "#);
    assert_eq!(
      got,
      vec![
        (r#""a""#.into(), "1".into()),
        (r#""b\"}""#.into(), r#"{"x": [1, "]", {}]}"#.into()),
        (r#""c""#.into(), r#""s\\""#.into()),
        (r#""d""#.into(), "null".into()),
      ]
    );
  }

  #[test]
  fn lists_array_children_and_empty_containers() {
    let got: Vec<String> = kids("[1,-2.5e3,true,[],{},[[]]]").into_iter().map(|(_, v)| v).collect();
    assert_eq!(got, vec!["1", "-2.5e3", "true", "[]", "{}", "[[]]"]);
    assert!(kids("[ ]").is_empty());
    assert!(kids("{\n}").is_empty());
  }

  #[test]
  fn handles_deep_nesting_without_recursion() {
    let depth = 100_000;
    let json = format!("[{}{}]", "[".repeat(depth), "]".repeat(depth));
    assert_eq!(skip_value(json.as_bytes(), 0).unwrap(), json.len());
  }

  #[test]
  fn reports_truncated_input() {
    assert!(skip_value(br#"{"a": [1, 2"#, 0).is_err());
    assert!(skip_value(br#""abc"#, 0).is_err());
    assert!(list_children(br#"[1 2]"#, 0).is_err());
  }

  #[test]
  fn previews_long_strings_on_safe_boundaries() {
    let body = format!("{}\\u00e9\\n中", "x".repeat(STRING_PREVIEW - 3));
    let quoted = format!("\"{body}\"");
    let preview: String = serde_json::from_str(&string_preview(quoted.as_bytes()).unwrap()).unwrap();
    assert!(preview.starts_with("xxx"));
    assert!(preview.len() <= STRING_PREVIEW + 8);
  }

  #[test]
  fn describes_values() {
    let d = |s: &str| describe(s.as_bytes(), 0, s.len()).unwrap();
    assert_eq!(d("[]").kind, "array");
    assert!(d("[ ]").empty);
    assert!(!d("[0]").empty);
    assert_eq!(d("{}").kind, "object");
    assert_eq!(d("\"hi\"").raw.as_deref(), Some("\"hi\""));
    assert_eq!(d("false").kind, "boolean");
    assert_eq!(d("null").kind, "null");
    assert_eq!(d("-1e5").kind, "number");
  }
}
