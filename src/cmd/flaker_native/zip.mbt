///| A file entry extracted from a ZIP archive.
pub struct ZipEntry {
  name : String
  data : Bytes
}

///| Copy a range of bytes.
fn bytes_slice(b : Bytes, start : Int, end : Int) -> Bytes {
  Bytes::makei(end - start, fn(i) { b[start + i] })
}

///| Extract files from a ZIP archive.
pub fn unzip(zip_bytes : Bytes) -> Array[ZipEntry] {
  let entries : Array[ZipEntry] = []
  let len = zip_bytes.length()
  let mut offset = 0
  while offset + 30 <= len {
    if zip_bytes[offset] != b'\x50' ||
      zip_bytes[offset + 1] != b'\x4b' ||
      zip_bytes[offset + 2] != b'\x03' ||
      zip_bytes[offset + 3] != b'\x04' {
      break
    }
    let compression = read_u16(zip_bytes, offset + 8)
    let compressed_size = read_u32(zip_bytes, offset + 18)
    let name_len = read_u16(zip_bytes, offset + 26)
    let extra_len = read_u16(zip_bytes, offset + 28)
    let header_end = offset + 30 + name_len + extra_len

    let name = bytes_to_string(bytes_slice(zip_bytes, offset + 30, offset + 30 + name_len))

    if header_end + compressed_size <= len {
      let raw = bytes_slice(zip_bytes, header_end, header_end + compressed_size)
      let data = if compression == 0 {
        raw
      } else if compression == 8 {
        try { @zlib.deflate_decompress(raw) } catch { _ => raw }
      } else {
        raw
      }
      if !name.has_suffix("/") {
        entries.push({ name, data })
      }
    }
    offset = header_end + compressed_size
  }
  entries
}

///|
fn read_u16(b : Bytes, offset : Int) -> Int {
  b[offset].to_int() | (b[offset + 1].to_int() << 8)
}

///|
fn read_u32(b : Bytes, offset : Int) -> Int {
  b[offset].to_int() |
    (b[offset + 1].to_int() << 8) |
    (b[offset + 2].to_int() << 16) |
    (b[offset + 3].to_int() << 24)
}
