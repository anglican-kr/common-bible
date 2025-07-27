#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
보안 모듈

인증, 암호화, 입력 검증 등 보안 관련 기능을 제공합니다.
- 환경변수 보안 관리
- API 인증 관리
- 입력 검증 및 새니타이징
"""

import os
import re
import html
import json
import hmac
import hashlib
import base64
import logging
from typing import Dict, Any, Optional, Union
from urllib.parse import urlparse

# 로거 설정
logger = logging.getLogger(__name__)


class SecurityManager:
    """보안 관리자 클래스"""
    
    def __init__(self):
        """보안 관리자 초기화"""
        self.wp_token = None
        self.wp_url = None
        self.load_credentials()
    
    def load_credentials(self) -> None:
        """환경변수에서 인증 정보 로드"""
        self.wp_token = os.getenv('WP_AUTH_TOKEN')
        self.wp_url = os.getenv('WP_BASE_URL')
        
        # 토큰 마스킹하여 로그
        if self.wp_token:
            masked_token = self.wp_token[:4] + '*' * (len(self.wp_token) - 8) + self.wp_token[-4:]
            logger.debug(f"WordPress 토큰 로드됨: {masked_token}")
        else:
            logger.warning("WordPress 토큰이 설정되지 않음")
        
        if self.wp_url:
            logger.debug(f"WordPress URL 로드됨: {self.wp_url}")
        else:
            logger.warning("WordPress URL이 설정되지 않음")
    
    def validate_https(self, url: str) -> bool:
        """
        HTTPS 연결 검증
        
        Args:
            url: 검증할 URL
        
        Returns:
            HTTPS 프로토콜 사용 여부
        """
        if not url:
            return False
        
        parsed = urlparse(url)
        return parsed.scheme == 'https'
    
    def validate_auth(self) -> bool:
        """
        인증 정보 유효성 검사
        
        Returns:
            인증 정보 유효 여부
        """
        if not self.wp_token or not self.wp_url:
            logger.warning("인증 정보가 불완전합니다")
            return False
        
        # HTTPS 검증
        if not self.validate_https(self.wp_url):
            logger.warning("보안 연결(HTTPS)이 사용되지 않습니다")
            return False
        
        return True
    
    def sanitize_input(self, text: str) -> str:
        """
        입력 텍스트 새니타이징 (HTML 이스케이프)
        
        Args:
            text: 입력 텍스트
        
        Returns:
            새니타이징된 텍스트
        """
        if not text:
            return ""
        return html.escape(text)
    
    def sanitize_html_content(self, content: str) -> str:
        """
        HTML 콘텐츠 새니타이징 (XSS 방지)
        
        Args:
            content: HTML 콘텐츠
        
        Returns:
            새니타이징된 HTML
        """
        if not content:
            return ""
        
        # 스크립트 태그 제거
        content = re.sub(r'<script[^>]*>.*?</script>', '', content, flags=re.DOTALL)
        
        # 이벤트 핸들러 제거
        content = re.sub(r'on\w+="[^"]*"', '', content)
        content = re.sub(r'on\w+=\'[^\']*\'', '', content)
        
        # iframe 제거
        content = re.sub(r'<iframe[^>]*>.*?</iframe>', '', content, flags=re.DOTALL)
        
        return content
    
    def sanitize_filename(self, filename: str) -> str:
        """
        파일명 새니타이징 (경로 순회 방지)
        
        Args:
            filename: 파일명
        
        Returns:
            새니타이징된 파일명
        """
        if not filename:
            return ""
        
        # 경로 순회 문자 제거
        filename = os.path.basename(filename)
        
        # 안전하지 않은 문자 대체
        filename = re.sub(r'[^\w\.-]', '_', filename)
        
        return filename
    
    def validate_json_data(self, data: Any) -> bool:
        """
        JSON 데이터 유효성 검사
        
        Args:
            data: 검증할 JSON 데이터
        
        Returns:
            유효 여부
        """
        if not data:
            return False
        
        try:
            # 문자열이면 파싱 시도
            if isinstance(data, str):
                json.loads(data)
            else:
                # 객체면 직렬화 시도
                json.dumps(data)
            return True
        except (json.JSONDecodeError, TypeError):
            return False
    
    def generate_signature(self, data: str, key: Optional[str] = None) -> str:
        """
        HMAC 서명 생성
        
        Args:
            data: 서명할 데이터
            key: 서명 키 (기본값: WP_AUTH_TOKEN)
        
        Returns:
            Base64 인코딩된 서명
        """
        if key is None:
            key = self.wp_token or 'default-key'
        
        h = hmac.new(
            key.encode('utf-8'),
            data.encode('utf-8'),
            hashlib.sha256
        )
        
        return base64.b64encode(h.digest()).decode('utf-8')
    
    def verify_signature(self, data: str, signature: str, key: Optional[str] = None) -> bool:
        """
        HMAC 서명 검증
        
        Args:
            data: 검증할 데이터
            signature: 검증할 서명
            key: 서명 키 (기본값: WP_AUTH_TOKEN)
        
        Returns:
            서명 일치 여부
        """
        expected = self.generate_signature(data, key)
        return hmac.compare_digest(expected, signature)


# 보안 관리자 싱글톤 인스턴스
security = SecurityManager()
