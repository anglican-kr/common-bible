#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
로깅 모듈

프로젝트 전체에서 일관된 로그 형식과 출력을 제공합니다.
- 파일 및 콘솔 로깅
- 컬러 로그 지원
- 로그 레벨 관리
"""

import os
import logging
import time
from pathlib import Path
from typing import Optional, Dict, Any
from logging.handlers import RotatingFileHandler
import colorlog

# 프로젝트 루트 경로 찾기
PROJECT_ROOT = Path(__file__).parent.parent.absolute()


class Logger:
    """로거 클래스"""
    
    _instance = None  # 싱글톤 인스턴스
    
    def __new__(cls):
        """싱글톤 패턴 구현"""
        if cls._instance is None:
            cls._instance = super(Logger, cls).__new__(cls)
            cls._instance._initialized = False
        return cls._instance
    
    def __init__(self):
        """로거 초기화"""
        if self._initialized:
            return
        
        self._initialized = True
        self.loggers = {}  # 이름별 로거 캐시
    
    def setup(self, log_level: str = 'INFO',
              log_file: Optional[str] = None,
              log_to_console: bool = True,
              use_color: bool = True) -> None:
        """
        로깅 시스템 설정
        
        Args:
            log_level: 로그 레벨 ('DEBUG', 'INFO', 'WARNING', 'ERROR')
            log_file: 로그 파일 경로 (None이면 기본값 사용)
            log_to_console: 콘솔에도 로그 출력 여부
            use_color: 컬러 로그 사용 여부
        """
        # 로그 레벨 설정
        log_level_map = {
            'DEBUG': logging.DEBUG,
            'INFO': logging.INFO,
            'WARNING': logging.WARNING,
            'ERROR': logging.ERROR,
            'CRITICAL': logging.CRITICAL
        }
        level = log_level_map.get(log_level.upper(), logging.INFO)
        
        # 로그 디렉토리 및 파일 설정
        if log_file is None:
            log_dir = os.path.join(PROJECT_ROOT, 'logs')
            if not os.path.exists(log_dir):
                os.makedirs(log_dir)
            
            # 타임스탬프가 포함된 로그 파일명
            timestamp = time.strftime('%Y%m%d')
            log_file = os.path.join(log_dir, f'bible_converter_{timestamp}.log')
        
        # 루트 로거 설정
        root_logger = logging.getLogger()
        root_logger.setLevel(level)
        
        # 기존 핸들러 제거
        for handler in root_logger.handlers[:]:
            root_logger.removeHandler(handler)
        
        # 로그 포맷 설정
        log_format = '%(asctime)s - %(name)s - %(levelname)s - %(message)s'
        
        # 파일 핸들러 (RotatingFileHandler 사용)
        file_formatter = logging.Formatter(log_format)
        file_handler = RotatingFileHandler(
            log_file, maxBytes=10*1024*1024, backupCount=5, encoding='utf-8'
        )
        file_handler.setFormatter(file_formatter)
        root_logger.addHandler(file_handler)
        
        # 콘솔 핸들러 (컬러 지원 옵션)
        if log_to_console:
            if use_color:
                # 컬러 포맷 설정
                color_formatter = colorlog.ColoredFormatter(
                    '%(log_color)s' + log_format,
                    log_colors={
                        'DEBUG': 'cyan',
                        'INFO': 'green',
                        'WARNING': 'yellow',
                        'ERROR': 'red',
                        'CRITICAL': 'bold_red',
                    }
                )
                console_handler = logging.StreamHandler()
                console_handler.setFormatter(color_formatter)
            else:
                console_handler = logging.StreamHandler()
                console_handler.setFormatter(file_formatter)
            
            root_logger.addHandler(console_handler)
        
        # 설정 완료 로그
        root_logger.info(f"로깅 설정 완료 (레벨: {log_level}, 파일: {log_file})")
    
    def get_logger(self, name: str) -> logging.Logger:
        """
        이름으로 로거 가져오기
        
        Args:
            name: 로거 이름
        
        Returns:
            해당 이름의 로거
        """
        if name not in self.loggers:
            logger = logging.getLogger(name)
            self.loggers[name] = logger
        
        return self.loggers[name]
    
    def set_level(self, level: str, logger_name: Optional[str] = None) -> None:
        """
        로그 레벨 설정
        
        Args:
            level: 로그 레벨 ('DEBUG', 'INFO', 'WARNING', 'ERROR')
            logger_name: 특정 로거 이름 (None이면 모든 로거 적용)
        """
        log_level_map = {
            'DEBUG': logging.DEBUG,
            'INFO': logging.INFO,
            'WARNING': logging.WARNING,
            'ERROR': logging.ERROR,
            'CRITICAL': logging.CRITICAL
        }
        level_value = log_level_map.get(level.upper(), logging.INFO)
        
        if logger_name:
            # 특정 로거만 변경
            logger = self.get_logger(logger_name)
            logger.setLevel(level_value)
        else:
            # 루트 로거 포함 모든 로거 변경
            root_logger = logging.getLogger()
            root_logger.setLevel(level_value)
            
            for name, logger in self.loggers.items():
                logger.setLevel(level_value)


# 싱글톤 인스턴스
logger = Logger()

# 기본 설정
logger.setup()


def get_logger(name: str) -> logging.Logger:
    """
    로거 인스턴스 가져오기 편의 함수
    
    Args:
        name: 로거 이름
    
    Returns:
        해당 이름의 로거
    """
    return logger.get_logger(name)


def set_log_level(level: str, logger_name: Optional[str] = None) -> None:
    """
    로그 레벨 설정 편의 함수
    
    Args:
        level: 로그 레벨 ('DEBUG', 'INFO', 'WARNING', 'ERROR')
        logger_name: 특정 로거 이름 (None이면 모든 로거 적용)
    """
    logger.set_level(level, logger_name)
