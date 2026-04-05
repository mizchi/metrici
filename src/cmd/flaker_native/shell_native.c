#include <stdio.h>
#include <stdlib.h>
#include <string.h>

// MoonBit Bytes layout: first 4/8 bytes are length, then data
// For extern "c" with Bytes, MoonBit passes a pointer to the byte data directly.

int flaker_system(const char *cmd) {
  int ret = system(cmd);
  // system() returns encoded status; extract exit code
  if (ret == -1) return -1;
#ifdef _WIN32
  return ret;
#else
  if (((ret) & 0x7f) == 0) return ((ret) >> 8) & 0xff; // WEXITSTATUS
  return ret;
#endif
}

int flaker_popen_read(const char *cmd, char *buf, int buf_len) {
  FILE *fp = popen(cmd, "r");
  if (!fp) return -1;
  int total = 0;
  while (total < buf_len - 1) {
    int ch = fgetc(fp);
    if (ch == EOF) break;
    buf[total++] = (char)ch;
  }
  buf[total] = '\0';
  pclose(fp);
  return total;
}
