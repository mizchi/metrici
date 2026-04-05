#!/bin/bash
# Build flaker-native standalone binary.
# Requires: brew install duckdb
set -e

BREW_PREFIX="${HOMEBREW_PREFIX:-/Users/mz/brew}"

C_INCLUDE_PATH="$BREW_PREFIX/include" \
LIBRARY_PATH="$BREW_PREFIX/lib" \
moon build --target native src/cmd/flaker_native 2>/dev/null || true

# moon build doesn't pass cc-link-flags for dependencies.
# Link manually with the generated C file.
BINARY="_build/native/debug/build/cmd/flaker_native/flaker_native"

if [ ! -f "${BINARY}.exe" ]; then
  echo "Linking manually..."
  cc -o "${BINARY}.exe" \
    -I"$HOME/.moon/include" \
    "$HOME/.moon/lib/libmoonbitrun.o" \
    "${BINARY}.c" \
    _build/native/debug/build/runtime.o \
    _build/native/debug/build/.mooncakes/f4ah6o/duckdb/libduckdb.a \
    _build/native/debug/build/.mooncakes/moonbitlang/async/internal/c_buffer/libc_buffer.a \
    _build/native/debug/build/.mooncakes/moonbitlang/async/internal/env_util/libenv_util.a \
    _build/native/debug/build/.mooncakes/moonbitlang/async/internal/os_string/libos_string.a \
    _build/native/debug/build/.mooncakes/moonbitlang/async/os_error/libos_error.a \
    _build/native/debug/build/.mooncakes/moonbitlang/async/internal/fd_util/libfd_util.a \
    _build/native/debug/build/.mooncakes/moonbitlang/async/internal/time/libtime.a \
    _build/native/debug/build/.mooncakes/moonbitlang/async/internal/event_loop/libevent_loop.a \
    _build/native/debug/build/.mooncakes/moonbitlang/async/socket/libsocket.a \
    _build/native/debug/build/.mooncakes/moonbitlang/async/tls/libtls.a \
    _build/native/debug/build/.mooncakes/moonbitlang/x/fs/libfs.a \
    _build/native/debug/build/.mooncakes/mizchi/zlib/libzlib.a \
    _build/native/debug/build/.mooncakes/moonbitlang/async/fs/libfs.a \
    -L"$BREW_PREFIX/lib" \
    -lduckdb -lz -lm \
    "$HOME/.moon/lib/libbacktrace.a" \
    -Wl,-rpath,"$BREW_PREFIX/lib"
fi

echo "Built: ${BINARY}.exe"
ls -lh "${BINARY}.exe"
