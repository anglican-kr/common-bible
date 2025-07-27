#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
공동번역성서 프로젝트 실행 스크립트

이 스크립트는 프로젝트 루트에서 실행되며, 
절대 import를 사용할 수 있도록 PYTHONPATH를 자동으로 설정합니다.
"""

import os
import sys
from pathlib import Path

# 프로젝트 루트 경로를 PYTHONPATH에 추가
project_root = Path(__file__).parent.absolute()
sys.path.insert(0, str(project_root))

# CLI 모듈 실행
if __name__ == "__main__":
    from src.cli import cli
    cli()
