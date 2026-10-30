#!/bin/bash
# 在 macOS 從原始碼編譯 KataGo（Eigen CPU 版），放到 engine/bin（Intel 另編一份不用 AVX2 的到 engine/bin-compat）
# 不需要 Homebrew：cmake 與 Eigen 都下載到快取資料夾
# 用法：bash scripts/build-katago-mac.sh [arm64|x86_64]
set -euo pipefail
VER=1.18.1
ARCH=${1:-$(uname -m)}
ROOT=$(cd "$(dirname "$0")/.." && pwd)
WORK=${KATAGO_WORK:-$HOME/.cache/xiaoke-katago}
JOBS=$(sysctl -n hw.ncpu 2>/dev/null || echo 4)
mkdir -p "$WORK"
cd "$WORK"

if [ ! -d eigen-3.4.0 ]; then
  echo "下載 Eigen 3.4.0"
  curl -fsSL https://gitlab.com/libeigen/eigen/-/archive/3.4.0/eigen-3.4.0.tar.gz | tar xz
fi
if [ ! -d "KataGo-$VER" ]; then
  echo "下載 KataGo v$VER 原始碼"
  curl -fsSL "https://github.com/lightvector/KataGo/archive/refs/tags/v$VER.tar.gz" | tar xz
fi
CMAKE=$(command -v cmake || true)
if [ -z "$CMAKE" ]; then
  if [ ! -x cmake-3.30.5-macos-universal/CMake.app/Contents/bin/cmake ]; then
    echo "下載 CMake"
    curl -fsSL https://github.com/Kitware/CMake/releases/download/v3.30.5/cmake-3.30.5-macos-universal.tar.gz | tar xz
  fi
  CMAKE="$WORK/cmake-3.30.5-macos-universal/CMake.app/Contents/bin/cmake"
fi

build() { # $1 = USE_AVX2（0/1），$2 = 目的資料夾
  local B="build-$ARCH-avx$1"
  "$CMAKE" -S "KataGo-$VER/cpp" -B "$B" -DUSE_BACKEND=EIGEN -DUSE_AVX2="$1" -DNO_GIT_REVISION=1 \
    -DEIGEN3_INCLUDE_DIRS="$WORK/eigen-3.4.0" -DCMAKE_BUILD_TYPE=Release \
    -DCMAKE_OSX_ARCHITECTURES="$ARCH" -DCMAKE_OSX_DEPLOYMENT_TARGET=11.0 > "$B.log" 2>&1 || { tail -30 "$B.log"; exit 1; }
  "$CMAKE" --build "$B" -j "$JOBS" >> "$B.log" 2>&1 || { tail -40 "$B.log"; exit 1; }
  mkdir -p "$ROOT/engine/$2"
  cp "$B/katago" "$ROOT/engine/$2/katago"
  chmod +x "$ROOT/engine/$2/katago"
  # Apple 晶片一定要有簽章才能執行：用 ad-hoc 簽章
  codesign --force --sign - "$ROOT/engine/$2/katago"
  file "$ROOT/engine/$2/katago"
}

if [ "$ARCH" = "x86_64" ]; then
  build 1 bin
  build 0 bin-compat
else
  build 0 bin
fi
echo "KataGo（${ARCH}）編譯完成"
