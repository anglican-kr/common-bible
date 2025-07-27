#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
공동번역성서 변환 메인 모듈

텍스트 파싱, HTML 생성, 워드프레스 게시 과정을 통합하여 실행합니다.
명령줄 인터페이스를 제공하여 다양한 작업 모드 지원
"""

import os
import sys
import logging
import argparse
from pathlib import Path
from typing import Optional, List, Dict, Any
import time

# 프로젝트 내 모듈 import
from src.config import config
from src.parser import BibleParser
from src.html_generator import HTMLGenerator
from src.wp_publisher import WordPressPublisher


def setup_logging(log_level: str = 'INFO') -> None:
    """
    로깅 설정
    
    Args:
        log_level: 로그 레벨 ('DEBUG', 'INFO', 'WARNING', 'ERROR')
    """
    log_level_map = {
        'DEBUG': logging.DEBUG,
        'INFO': logging.INFO,
        'WARNING': logging.WARNING,
        'ERROR': logging.ERROR
    }
    
    level = log_level_map.get(log_level.upper(), logging.INFO)
    
    # 로그 형식 및 핸들러 설정
    log_dir = os.path.join(config.paths['project_root'], 'logs')
    if not os.path.exists(log_dir):
        os.makedirs(log_dir)
    
    log_file = os.path.join(log_dir, 'bible_converter.log')
    
    logging.basicConfig(
        level=level,
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
        handlers=[
            logging.FileHandler(log_file),
            logging.StreamHandler()
        ]
    )


def parse_text(input_file: Optional[str] = None, output_file: Optional[str] = None, 
               split_chapters: bool = False) -> Optional[str]:
    """
    텍스트 파일 파싱
    
    Args:
        input_file: 입력 텍스트 파일 경로
        output_file: 출력 JSON 파일 경로
        split_chapters: 장별로 분할 저장 여부
    
    Returns:
        출력 파일 경로 또는 에러시 None
    """
    logger = logging.getLogger(__name__)
    logger.info("텍스트 파싱 시작")
    
    try:
        # 기본 경로 설정
        if input_file is None:
            input_file = os.path.join(config.paths['data_dir'], 'common-bible-kr.txt')
        
        if output_file is None:
            output_file = os.path.join(config.paths['output_dir'], 'bible.json')
        
        # 파서 초기화 및 실행
        parser = BibleParser(input_file)
        bible = parser.parse_file()
        
        # 결과 저장
        parser.save_to_json(output_file)
        
        # 장별 저장
        if split_chapters:
            parser.save_chapters_json()
        
        logger.info(f"파싱 완료: {len(bible.books)}권, 총 {sum(len(book.chapters) for book in bible.books)}장")
        return output_file
        
    except Exception as e:
        logger.error(f"파싱 실패: {e}")
        return None


def generate_html(json_input: Optional[str] = None, html_dir: Optional[str] = None,
                 template_dir: Optional[str] = None) -> Optional[Dict[str, str]]:
    """
    HTML 파일 생성
    
    Args:
        json_input: 입력 JSON 파일 또는 디렉토리 경로
        html_dir: 출력 HTML 디렉토리
        template_dir: 템플릿 디렉토리
    
    Returns:
        생성된 HTML 파일 경로 매핑 또는 에러시 None
    """
    logger = logging.getLogger(__name__)
    logger.info("HTML 생성 시작")
    
    try:
        # HTML 생성기 초기화
        generator = HTMLGenerator(template_dir)
        
        # 출력 디렉토리 설정
        if html_dir:
            generator.output_dir = html_dir
            if not os.path.exists(html_dir):
                os.makedirs(html_dir)
        
        # 입력 경로에 따라 처리
        if not json_input:
            json_input = os.path.join(config.paths['output_dir'], 'chapters')
        
        # JSON 디렉토리 또는 파일인지 확인
        if os.path.isdir(json_input):
            result = generator.generate_html_from_json(json_input)
        elif os.path.isfile(json_input) and json_input.endswith('.json'):
            # TODO: 단일 파일 처리 구현
            logger.warning("단일 JSON 파일 처리는 아직 구현되지 않았습니다")
            result = {}
        else:
            logger.error(f"잘못된 입력 경로: {json_input}")
            return None
        
        logger.info(f"HTML 생성 완료: {len(result)}개 파일")
        return result
        
    except Exception as e:
        logger.error(f"HTML 생성 실패: {e}")
        return None


def publish_to_wordpress(html_dir: Optional[str] = None, status: str = 'private',
                        test_auth: bool = False) -> bool:
    """
    워드프레스에 HTML 파일 게시
    
    Args:
        html_dir: HTML 파일 디렉토리
        status: 게시 상태 ('private', 'draft', 'publish')
        test_auth: 인증 테스트만 수행
    
    Returns:
        성공 여부
    """
    logger = logging.getLogger(__name__)
    logger.info("워드프레스 게시 시작")
    
    try:
        # 워드프레스 게시자 초기화
        publisher = WordPressPublisher()
        
        # 인증 테스트
        if test_auth or not publisher.validate_auth():
            is_valid = publisher.validate_auth()
            logger.info(f"인증 테스트: {'성공' if is_valid else '실패'}")
            
            if test_auth:  # 테스트 모드면 여기서 종료
                return is_valid
            
            if not is_valid:  # 실제 게시 모드인데 인증 실패
                logger.error("인증 실패로 게시를 중단합니다")
                return False
        
        # HTML 디렉토리 확인
        if not html_dir:
            html_dir = os.path.join(config.paths['output_dir'], 'html')
        
        if not os.path.exists(html_dir):
            logger.error(f"HTML 디렉토리를 찾을 수 없음: {html_dir}")
            return False
        
        # 일괄 게시
        success_files = publisher.batch_publish_html_files(html_dir, status)
        
        # 메타데이터 저장
        publisher.save_posts_metadata()
        
        logger.info(f"게시 완료: {len(success_files)}개 파일 성공")
        return len(success_files) > 0
        
    except Exception as e:
        logger.error(f"게시 실패: {e}")
        return False


def run_full_pipeline(input_file: Optional[str] = None, status: str = 'private') -> bool:
    """
    전체 파이프라인 실행 (파싱 → HTML 생성 → 워드프레스 게시)
    
    Args:
        input_file: 입력 텍스트 파일 경로
        status: 게시 상태
    
    Returns:
        성공 여부
    """
    logger = logging.getLogger(__name__)
    logger.info("전체 파이프라인 실행 시작")
    
    start_time = time.time()
    
    # 1. 텍스트 파싱
    json_output = parse_text(input_file, split_chapters=True)
    if not json_output:
        logger.error("파싱 단계 실패, 파이프라인 중단")
        return False
    
    # 2. HTML 생성
    json_chapters_dir = os.path.join(config.paths['output_dir'], 'chapters')
    html_result = generate_html(json_chapters_dir)
    if not html_result:
        logger.error("HTML 생성 단계 실패, 파이프라인 중단")
        return False
    
    # 3. 워드프레스 게시
    html_dir = os.path.join(config.paths['output_dir'], 'html')
    publish_result = publish_to_wordpress(html_dir, status)
    if not publish_result:
        logger.error("워드프레스 게시 단계 실패")
        return False
    
    elapsed_time = time.time() - start_time
    logger.info(f"전체 파이프라인 완료 (소요 시간: {elapsed_time:.2f}초)")
    return True


def main():
    """명령줄 인터페이스"""
    parser = argparse.ArgumentParser(
        description='공동번역성서 변환 도구',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
예시:
  # 전체 파이프라인 실행
  python main.py --full-pipeline
  
  # 텍스트 파싱만 실행
  python main.py --parse
  
  # HTML 생성만 실행
  python main.py --generate-html
  
  # 워드프레스 게시만 실행
  python main.py --publish --status=private
  
  # 인증 테스트만 실행
  python main.py --test-auth
        """
    )
    
    # 모드 선택 인자
    mode_group = parser.add_argument_group('실행 모드')
    mode_group.add_argument('--full-pipeline', action='store_true', help='전체 파이프라인 실행')
    mode_group.add_argument('--parse', action='store_true', help='텍스트 파싱만 실행')
    mode_group.add_argument('--generate-html', action='store_true', help='HTML 생성만 실행')
    mode_group.add_argument('--publish', action='store_true', help='워드프레스 게시만 실행')
    mode_group.add_argument('--test-auth', action='store_true', help='워드프레스 인증 테스트만 실행')
    
    # 파싱 관련 인자
    parser.add_argument('--input', '-i', help='입력 텍스트 파일 경로')
    parser.add_argument('--output', '-o', help='출력 JSON 파일 경로')
    parser.add_argument('--split-chapters', '-s', action='store_true', help='장별로 분할하여 저장')
    
    # HTML 생성 관련 인자
    parser.add_argument('--json-input', help='입력 JSON 파일 또는 디렉토리 경로')
    parser.add_argument('--html-dir', help='출력 HTML 디렉토리')
    parser.add_argument('--template-dir', help='템플릿 디렉토리')
    
    # 워드프레스 관련 인자
    parser.add_argument('--status', default='private', 
                       choices=['private', 'draft', 'publish'], 
                       help='게시 상태')
    
    # 기타 인자
    parser.add_argument('--log-level', default='INFO',
                       choices=['DEBUG', 'INFO', 'WARNING', 'ERROR'],
                       help='로그 레벨')
    
    args = parser.parse_args()
    
    # 로깅 설정
    setup_logging(args.log_level)
    
    logger = logging.getLogger(__name__)
    logger.info("공동번역성서 변환 도구 시작")
    
    # 실행 모드 확인 및 실행
    if args.full_pipeline:
        success = run_full_pipeline(args.input, args.status)
        sys.exit(0 if success else 1)
    
    elif args.parse:
        result = parse_text(args.input, args.output, args.split_chapters)
        sys.exit(0 if result else 1)
    
    elif args.generate_html:
        result = generate_html(args.json_input, args.html_dir, args.template_dir)
        sys.exit(0 if result else 1)
    
    elif args.publish:
        result = publish_to_wordpress(args.html_dir, args.status, False)
        sys.exit(0 if result else 1)
    
    elif args.test_auth:
        result = publish_to_wordpress(None, args.status, True)
        sys.exit(0 if result else 1)
    
    else:
        # 기본 도움말 표시
        parser.print_help()


if __name__ == "__main__":
    main()
