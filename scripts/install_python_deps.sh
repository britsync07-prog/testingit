#!/usr/bin/env bash
set -euo pipefail
python3 -m pip install --upgrade pip --break-system-packages
python3 -m pip install -r requirements.txt --break-system-packages
