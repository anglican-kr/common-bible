#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
설정 관리 모듈

공동번역성서 프로젝트에서 사용하는 각종 설정 값을 관리합니다.
환경변수, 파일 경로, API 설정 등을 로드하고 검증합니다.
"""

import os
import json
import logging
from typing import Dict, Any, Optional
from pathlib import Path
from dotenv import load_dotenv

# 프로젝트 루트 경로 찾기
PROJECT_ROOT = Path(__file__).parent.parent.absolute()

class Config:
    """설정 관리 클래스"""
    
    def __init__(self, env_file: Optional[str] = None):
        """
        설정 객체 초기화
        
        Args:
            env_file: 환경변수 파일 경로 (기본값: PROJECT_ROOT/config/.env)
        """
        self.logger = logging.getLogger(__name__)
        
        # 기본 환경변수 파일 경로
        if env_file is None:
            env_file = os.path.join(PROJECT_ROOT, 'config', '.env')
        
        # 환경변수 로드
        self._load_env_vars(env_file)
        
        # 로깅 설정
        self._setup_logging()
        
        # 경로 설정
        self.paths = self._setup_paths()
        
        self.logger.info("설정 로드 완료")
    
    def _load_env_vars(self, env_file: str) -> None:
        """
        환경변수 파일(.env)에서 설정 로드
        
        Args:
            env_file: 환경변수 파일 경로
        """
        if os.path.exists(env_file):
            load_dotenv(env_file)
            self.logger.debug(f"환경변수 파일 로드: {env_file}")
        else:
            self.logger.warning(f"환경변수 파일 없음: {env_file}")
    
    def _setup_logging(self) -> None:
        """로깅 시스템 설정"""
        log_level_str = os.getenv('LOG_LEVEL', 'INFO').upper()
        log_levels = {
            'DEBUG': logging.DEBUG,
            'INFO': logging.INFO,
            'WARNING': logging.WARNING,
            'ERROR': logging.ERROR,
            'CRITICAL': logging.CRITICAL
        }
        log_level = log_levels.get(log_level_str, logging.INFO)
        
        log_dir = os.path.join(PROJECT_ROOT, 'logs')
        if not os.path.exists(log_dir):
            os.makedirs(log_dir)
        
        log_file = os.path.join(log_dir, 'bible_converter.log')
        
        logging.basicConfig(
            level=log_level,
            format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
            handlers=[
                logging.FileHandler(log_file),
                logging.StreamHandler()
            ]
        )
    
    def _setup_paths(self) -> Dict[str, str]:
        """경로 설정 및 유효성 검사"""
        paths = {
            'project_root': str(PROJECT_ROOT),
            'data_dir': os.path.join(PROJECT_ROOT, 'data'),
            'templates_dir': os.path.join(PROJECT_ROOT, 'templates'),
            'static_dir': os.path.join(PROJECT_ROOT, 'static'),
            'output_dir': os.path.join(PROJECT_ROOT, 'data', 'output')
        }
        
        # 출력 디렉토리 생성
        if not os.path.exists(paths['output_dir']):
            os.makedirs(paths['output_dir'])
            self.logger.info(f"출력 디렉토리 생성: {paths['output_dir']}")
        
        return paths
    
    def get_wp_config(self) -> Dict[str, Any]:
        """워드프레스 관련 설정 반환"""
        return {
            'base_url': os.getenv('WP_BASE_URL', ''),
            'auth_token': os.getenv('WP_AUTH_TOKEN', ''),
            'api_rate_limit': int(os.getenv('WP_API_RATE_LIMIT', '60'))
        }
    
    def load_book_mappings(self) -> list:
        """
        성경 책 이름 매핑 데이터 로드
        
        Returns:
            매핑 데이터 리스트
        """
        mapping_path = os.path.join(self.paths['data_dir'], 'bible_book_mappings.json')
        try:
            with open(mapping_path, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception as e:
            self.logger.error(f"책 매핑 파일 로드 실패: {e}")
            return []
    
    def validate(self) -> bool:
        """
        설정 유효성 검사
        
        Returns:
            유효성 검사 통과 여부
        """
        # WordPress 설정 검증
        wp_config = self.get_wp_config()
        if not wp_config['base_url'] or not wp_config['auth_token']:
            self.logger.warning("WordPress API 설정이 불완전합니다")
            return False
        
        # HTTPS 검증
        if wp_config['base_url'] and not wp_config['base_url'].startswith('https://'):
            self.logger.warning("WordPress URL이 HTTPS가 아닙니다")
            return False
        
        return True


# 기본 설정 객체 (싱글톤 패턴)
config = Config()
