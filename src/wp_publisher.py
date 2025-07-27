#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
워드프레스 게시자 모듈

HTML 파일을 워드프레스에 게시하는 기능을 담당합니다.
- REST API를 통한 포스트 생성
- 인증 및 권한 관리
- 일괄 게시 및 상태 관리
"""

import os
import re
import time
import json
import logging
import argparse
import requests
from typing import Dict, List, Any, Optional, Tuple
from pathlib import Path

from src.models import Chapter
from src.config import config


class WordPressPublisher:
    """워드프레스 게시자 클래스"""
    
    def __init__(self, wp_url: Optional[str] = None, auth_token: Optional[str] = None):
        """
        워드프레스 게시자 초기화
        
        Args:
            wp_url: 워드프레스 사이트 URL (기본값: 환경변수에서 설정)
            auth_token: 인증 토큰 (기본값: 환경변수에서 설정)
        """
        self.logger = logging.getLogger(__name__)
        
        # 설정 로드
        wp_config = config.get_wp_config()
        
        # 매개변수가 없으면 환경변수에서 설정 가져오기
        self.wp_url = wp_url or wp_config['base_url']
        self.auth_token = auth_token or wp_config['auth_token']
        self.api_rate_limit = wp_config['api_rate_limit']
        
        # API 요청 세션
        self.session = requests.Session()
        
        # API 엔드포인트
        self._setup_endpoints()
        
        # 결과 캐시
        self.published_posts = {}
        
        self.logger.info(f"워드프레스 게시자 초기화: {self.wp_url}")
    
    def _setup_endpoints(self) -> None:
        """API 엔드포인트 설정"""
        self.endpoints = {
            'posts': f"{self.wp_url}/wp-json/wp/v2/posts",
            'categories': f"{self.wp_url}/wp-json/wp/v2/categories",
            'tags': f"{self.wp_url}/wp-json/wp/v2/tags",
            'media': f"{self.wp_url}/wp-json/wp/v2/media",
            'users': f"{self.wp_url}/wp-json/wp/v2/users"
        }
    
    def validate_auth(self) -> bool:
        """
        인증 상태 확인
        
        Returns:
            인증 성공 여부
        """
        if not self.wp_url or not self.auth_token:
            self.logger.error("WordPress URL 또는 인증 토큰이 설정되지 않았습니다")
            return False
        
        # HTTPS 검증
        if not self.wp_url.startswith('https://'):
            self.logger.warning("보안 연결(HTTPS)이 사용되지 않습니다")
        
        # 인증 검증
        headers = self._get_auth_headers()
        try:
            response = self.session.get(f"{self.wp_url}/wp-json/wp/v2", headers=headers)
            response.raise_for_status()
            self.logger.info("WordPress 인증 성공")
            return True
        except requests.exceptions.RequestException as e:
            self.logger.error(f"WordPress 인증 실패: {e}")
            return False
    
    def _get_auth_headers(self) -> Dict[str, str]:
        """
        인증 헤더 생성
        
        Returns:
            인증 헤더 사전
        """
        return {
            'Authorization': f'Bearer {self.auth_token}',
            'Content-Type': 'application/json'
        }
    
    def publish_chapter(self, chapter: Chapter, html_content: str, status: str = 'private') -> Optional[int]:
        """
        장을 워드프레스에 게시
        
        Args:
            chapter: 게시할 Chapter 객체
            html_content: HTML 내용
            status: 게시 상태 ('private', 'draft', 'publish')
        
        Returns:
            게시된 글 ID 또는 None (실패 시)
        """
        # 글 제목
        title = f"{chapter.book_name} {chapter.chapter_number}장"
        
        # 게시물 데이터
        post_data = {
            'title': title,
            'content': html_content,
            'status': status,
            'comment_status': 'closed',  # 댓글 비활성화
            'ping_status': 'closed',     # 핑백 비활성화
            'meta': {
                'bible_book': chapter.book_name,
                'bible_chapter': chapter.chapter_number,
                'bible_id': chapter.id
            }
        }
        
        # 카테고리 설정
        category_id = self._get_or_create_category("성경", "bible")
        if category_id:
            post_data['categories'] = [category_id]
        
        # 태그 설정
        tags = [
            self._get_or_create_tag(chapter.book_name),
            self._get_or_create_tag(f"{chapter.book_name} {chapter.chapter_number}장")
        ]
        post_data['tags'] = [tag_id for tag_id in tags if tag_id is not None]
        
        # API 요청
        try:
            response = self.session.post(
                self.endpoints['posts'],
                headers=self._get_auth_headers(),
                json=post_data
            )
            response.raise_for_status()
            result = response.json()
            post_id = result.get('id')
            
            if post_id:
                self.published_posts[chapter.id] = {
                    'post_id': post_id,
                    'title': title,
                    'permalink': result.get('link', '')
                }
                self.logger.info(f"게시 성공: {title} (ID: {post_id}, 상태: {status})")
                return post_id
            else:
                self.logger.error(f"게시 실패: 응답에 ID가 없음 - {title}")
                return None
                
        except requests.exceptions.RequestException as e:
            self.logger.error(f"게시 실패: {title} - {e}")
            return None
    
    def _get_or_create_category(self, name: str, slug: Optional[str] = None) -> Optional[int]:
        """
        카테고리 가져오기 또는 생성
        
        Args:
            name: 카테고리 이름
            slug: 카테고리 슬러그
        
        Returns:
            카테고리 ID 또는 None (실패 시)
        """
        # 기존 카테고리 확인
        try:
            response = self.session.get(
                self.endpoints['categories'],
                headers=self._get_auth_headers(),
                params={'search': name}
            )
            response.raise_for_status()
            categories = response.json()
            
            for category in categories:
                if category['name'].lower() == name.lower():
                    return category['id']
            
            # 없으면 새로 생성
            if slug is None:
                slug = name.lower().replace(' ', '-')
            
            category_data = {
                'name': name,
                'slug': slug
            }
            
            response = self.session.post(
                self.endpoints['categories'],
                headers=self._get_auth_headers(),
                json=category_data
            )
            response.raise_for_status()
            result = response.json()
            return result.get('id')
            
        except requests.exceptions.RequestException as e:
            self.logger.error(f"카테고리 생성 실패: {name} - {e}")
            return None
    
    def _get_or_create_tag(self, name: str) -> Optional[int]:
        """
        태그 가져오기 또는 생성
        
        Args:
            name: 태그 이름
        
        Returns:
            태그 ID 또는 None (실패 시)
        """
        # 비슷한 로직으로 태그 처리
        try:
            response = self.session.get(
                self.endpoints['tags'],
                headers=self._get_auth_headers(),
                params={'search': name}
            )
            response.raise_for_status()
            tags = response.json()
            
            for tag in tags:
                if tag['name'].lower() == name.lower():
                    return tag['id']
            
            # 없으면 새로 생성
            slug = name.lower().replace(' ', '-')
            tag_data = {
                'name': name,
                'slug': slug
            }
            
            response = self.session.post(
                self.endpoints['tags'],
                headers=self._get_auth_headers(),
                json=tag_data
            )
            response.raise_for_status()
            result = response.json()
            return result.get('id')
            
        except requests.exceptions.RequestException as e:
            self.logger.error(f"태그 생성 실패: {name} - {e}")
            return None
    
    def publish_html_file(self, file_path: str, status: str = 'private') -> Optional[int]:
        """
        HTML 파일을 워드프레스에 게시
        
        Args:
            file_path: HTML 파일 경로
            status: 게시 상태
        
        Returns:
            게시된 글 ID 또는 None (실패 시)
        """
        try:
            # 파일 이름에서 장 ID 추출
            file_name = os.path.basename(file_path)
            chapter_id = os.path.splitext(file_name)[0]
            
            # 파일 내용 읽기
            with open(file_path, 'r', encoding='utf-8') as f:
                html_content = f.read()
            
            # 파일 내용에서 제목 추출
            title_match = re.search(r'<title>(.*?)</title>', html_content)
            title = title_match.group(1) if title_match else file_name
            
            # 모의 Chapter 객체 생성
            parts = chapter_id.split('-')
            if len(parts) != 2:
                self.logger.error(f"파일 이름에서 장 정보를 추출할 수 없음: {file_name}")
                return None
            
            book_abbr, chapter_num = parts
            chapter = Chapter(
                book_name=book_abbr,  # 정확한 이름은 알 수 없음
                chapter_number=int(chapter_num),
                book_abbr=book_abbr,
                id=chapter_id
            )
            
            # 게시 요청
            return self.publish_chapter(chapter, html_content, status)
            
        except Exception as e:
            self.logger.error(f"HTML 파일 게시 실패: {file_path} - {e}")
            return None
    
    def batch_publish_html_files(self, html_dir: str, status: str = 'private') -> List[str]:
        """
        디렉토리의 모든 HTML 파일을 일괄 게시
        
        Args:
            html_dir: HTML 파일 디렉토리
            status: 게시 상태
        
        Returns:
            성공적으로 게시된 파일 목록
        """
        success_files = []
        
        # 디렉토리 내 HTML 파일 검색
        html_files = []
        for root, _, files in os.walk(html_dir):
            for file in files:
                if file.endswith('.html'):
                    html_files.append(os.path.join(root, file))
        
        total_files = len(html_files)
        self.logger.info(f"총 {total_files}개 HTML 파일 게시 시작")
        
        # 일괄 게시
        for i, file_path in enumerate(html_files, 1):
            self.logger.info(f"[{i}/{total_files}] 게시 중: {os.path.basename(file_path)}")
            
            post_id = self.publish_html_file(file_path, status)
            if post_id:
                success_files.append(file_path)
            
            # API 호출 제한 고려한 지연
            if i % 10 == 0:
                time.sleep(60 / self.api_rate_limit)
        
        self.logger.info(f"일괄 게시 완료: {len(success_files)}/{total_files} 성공")
        return success_files
    
    def update_post_status(self, post_id: int, status: str) -> bool:
        """
        게시물 상태 업데이트
        
        Args:
            post_id: 게시물 ID
            status: 변경할 상태 ('private', 'draft', 'publish')
        
        Returns:
            업데이트 성공 여부
        """
        try:
            response = self.session.post(
                f"{self.endpoints['posts']}/{post_id}",
                headers=self._get_auth_headers(),
                json={'status': status}
            )
            response.raise_for_status()
            self.logger.info(f"게시물 상태 변경: ID {post_id} -> {status}")
            return True
            
        except requests.exceptions.RequestException as e:
            self.logger.error(f"게시물 상태 변경 실패: ID {post_id} - {e}")
            return False
    
    def batch_update_status(self, status: str = 'publish') -> Tuple[int, int]:
        """
        이전에 게시한 모든 글의 상태를 일괄 업데이트
        
        Args:
            status: 변경할 상태
        
        Returns:
            (성공 개수, 실패 개수) 튜플
        """
        if not self.published_posts:
            self.logger.warning("업데이트할 게시물이 없음")
            return 0, 0
        
        success, fail = 0, 0
        total = len(self.published_posts)
        
        self.logger.info(f"총 {total}개 게시물 상태 업데이트 시작: -> {status}")
        
        for chapter_id, post_data in self.published_posts.items():
            post_id = post_data['post_id']
            title = post_data['title']
            
            self.logger.info(f"상태 변경: {title} (ID: {post_id}) -> {status}")
            
            if self.update_post_status(post_id, status):
                success += 1
            else:
                fail += 1
            
            # API 호출 제한 고려한 지연
            if (success + fail) % 10 == 0:
                time.sleep(60 / self.api_rate_limit)
        
        self.logger.info(f"일괄 상태 변경 완료: {success}/{total} 성공")
        return success, fail
    
    def save_posts_metadata(self, output_path: Optional[str] = None) -> None:
        """
        게시된 글 메타데이터 저장
        
        Args:
            output_path: 출력 파일 경로 (기본값: output/published_posts.json)
        """
        if not self.published_posts:
            self.logger.warning("저장할 게시물 메타데이터가 없음")
            return
        
        if output_path is None:
            output_path = os.path.join(config.paths['output_dir'], 'published_posts.json')
        
        # 출력 디렉토리 확인
        output_dir = os.path.dirname(output_path)
        if not os.path.exists(output_dir):
            os.makedirs(output_dir)
        
        # 데이터 저장
        try:
            with open(output_path, 'w', encoding='utf-8') as f:
                json.dump(self.published_posts, f, ensure_ascii=False, indent=2)
            self.logger.info(f"게시물 메타데이터 저장 완료: {output_path}")
        except Exception as e:
            self.logger.error(f"메타데이터 저장 실패: {e}")


def main():
    """CLI 진입점"""
    parser = argparse.ArgumentParser(description='워드프레스 게시 도구')
    parser.add_argument('--test-auth', action='store_true', help='인증 테스트')
    parser.add_argument('--upload-file', '-f', help='업로드할 HTML 파일 경로')
    parser.add_argument('--upload-all', action='store_true', help='모든 HTML 파일 업로드')
    parser.add_argument('--html-dir', help='HTML 파일 디렉토리 (--upload-all 시 필요)')
    parser.add_argument('--status', default='private', choices=['private', 'draft', 'publish'], help='게시 상태')
    parser.add_argument('--publish-all', action='store_true', help='이전에 업로드한 모든 글의 상태를 publish로 변경')
    args = parser.parse_args()
    
    # 워드프레스 게시자 초기화
    publisher = WordPressPublisher()
    
    # 인증 테스트
    if args.test_auth:
        if publisher.validate_auth():
            print("인증 성공: WordPress API에 연결되었습니다.")
        else:
            print("인증 실패: 환경변수와 API 설정을 확인하세요.")
        return
    
    # 단일 파일 업로드
    if args.upload_file:
        if os.path.exists(args.upload_file):
            post_id = publisher.publish_html_file(args.upload_file, args.status)
            if post_id:
                print(f"업로드 성공: ID {post_id}")
            else:
                print("업로드 실패")
        else:
            print(f"파일을 찾을 수 없음: {args.upload_file}")
    
    # 모든 파일 업로드
    elif args.upload_all:
        html_dir = args.html_dir or os.path.join(config.paths['output_dir'], 'html')
        if os.path.exists(html_dir):
            success_files = publisher.batch_publish_html_files(html_dir, args.status)
            print(f"일괄 업로드 완료: {len(success_files)}개 파일 성공")
            # 메타데이터 저장
            publisher.save_posts_metadata()
        else:
            print(f"디렉토리를 찾을 수 없음: {html_dir}")
    
    # 이전 게시물 상태 변경
    elif args.publish_all:
        # 이전 메타데이터 로드
        meta_path = os.path.join(config.paths['output_dir'], 'published_posts.json')
        if os.path.exists(meta_path):
            try:
                with open(meta_path, 'r', encoding='utf-8') as f:
                    publisher.published_posts = json.load(f)
                
                success, fail = publisher.batch_update_status('publish')
                print(f"상태 변경 완료: {success}개 성공, {fail}개 실패")
                # 메타데이터 다시 저장
                publisher.save_posts_metadata()
            except Exception as e:
                print(f"메타데이터 로드 실패: {e}")
        else:
            print(f"게시물 메타데이터 파일을 찾을 수 없음: {meta_path}")
    
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
