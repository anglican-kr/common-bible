"""
공동번역성서 프로젝트 설정 관리
환경변수와 기본 설정값을 관리하는 모듈
"""

import os
from pathlib import Path
from typing import List, Optional
from dotenv import load_dotenv


class Config:
    """프로젝트 설정 클래스"""

    def __init__(self):
        """설정 초기화 및 환경변수 로드"""
        # .env 파일 로드
        load_dotenv()

        # 프로젝트 루트 디렉토리
        self.project_root = Path(__file__).parent.parent

        # 파일 경로 설정
        self._setup_file_paths()

        # WordPress 설정
        self._setup_wordpress_config()

        # 기타 설정
        self._setup_other_config()

        # 필수 설정 검증
        self._validate_required_settings()

    def _setup_file_paths(self) -> None:
        """파일 경로 설정"""
        # 입력 파일
        self.bible_text_path = os.getenv(
            'BIBLE_TEXT_PATH',
            str(self.project_root / 'data' / 'common-bible-kr.txt')
        )

        # 매핑 데이터
        self.book_mappings_path = os.getenv(
            'BOOK_MAPPINGS_PATH',
            str(self.project_root / 'data' / 'book_mappings.json')
        )

        # HTML 템플릿
        self.template_path = os.getenv(
            'TEMPLATE_PATH',
            str(self.project_root / 'templates' / 'chapter.html')
        )

        # 출력 디렉토리
        self.output_dir = Path(os.getenv(
            'OUTPUT_DIR',
            str(self.project_root / 'output')
        ))

        # 로그 디렉토리
        self.log_dir = Path(os.getenv(
            'LOG_DIR',
            str(self.project_root / 'logs')
        ))

        # 오디오 기본 URL
        self.audio_base_url = os.getenv(
            'AUDIO_BASE_URL',
            'data/audio'
        )

    def _setup_wordpress_config(self) -> None:
        """WordPress 관련 설정"""
        # 필수 설정
        self.wp_site_url = os.getenv(
            'WP_SITE_URL', 'https://seoul.anglican.kr')
        self.wp_username = os.getenv('WP_USERNAME')
        self.wp_password = os.getenv('WP_PASSWORD')

        # 카테고리/태그 자동 생성 설정
        self.wp_base_category = os.getenv('WP_BASE_CATEGORY', '공동번역성서')
        self.wp_base_tag = os.getenv('WP_BASE_TAG', '공동번역성서')

        # 게시물 기본 상태
        self.wp_default_status = os.getenv('WP_DEFAULT_STATUS', 'private')

        # API 요청 타임아웃 (초)
        self.wp_timeout = int(os.getenv('WP_TIMEOUT', '30'))

        # API 재시도 횟수
        self.wp_retry_count = int(os.getenv('WP_RETRY_COUNT', '3'))

    def _setup_other_config(self) -> None:
        """기타 설정"""
        # 로깅 설정
        self.log_level = os.getenv('LOG_LEVEL', 'INFO').upper()
        self.log_to_console = os.getenv(
            'LOG_TO_CONSOLE', 'true').lower() == 'true'
        self.log_color = os.getenv('LOG_COLOR', 'true').lower() == 'true'

        # 보안 설정
        self.verify_ssl = os.getenv('VERIFY_SSL', 'true').lower() == 'true'

        # 성능 설정
        self.max_workers = int(os.getenv('MAX_WORKERS', '4'))

        # 디버그 모드
        self.debug = os.getenv('DEBUG', 'false').lower() == 'true'

    def _validate_required_settings(self) -> None:
        """필수 설정값 검증"""
        errors = []

        # WordPress 인증 정보 확인
        if not self.wp_username:
            errors.append("WP_USERNAME 환경변수가 설정되지 않았습니다.")

        if not self.wp_password:
            errors.append("WP_PASSWORD 환경변수가 설정되지 않았습니다.")

        # 필수 파일 존재 확인
        if not os.path.exists(self.book_mappings_path):
            errors.append(f"책 매핑 파일이 존재하지 않습니다: {self.book_mappings_path}")

        # 디렉토리 생성
        self.output_dir.mkdir(exist_ok=True)
        self.log_dir.mkdir(exist_ok=True)

        if errors:
            error_message = "\n".join([f"- {error}" for error in errors])
            raise ValueError(
                f"설정 오류:\n{error_message}\n\n.env 파일을 확인하고 필요한 설정을 추가해주세요.")

    def get_log_file_path(self) -> str:
        """로그 파일 경로 생성"""
        import datetime
        timestamp = datetime.datetime.now().strftime('%Y%m%d')
        return str(self.log_dir / f'bible_converter_{timestamp}.log')

    def get_audio_file_path(self, book_abbr: str, chapter_number: int) -> str:
        """오디오 파일 경로 생성"""
        # 영문 슬러그 매핑 (추후 book_mappings.json에서 가져올 수 있음)
        book_slug_map = {
            "창세": "genesis",
            "출애": "exodus",
            "레위": "leviticus",
            "민수": "numbers",
            "신명": "deuteronomy",
            # ... 필요에 따라 추가
        }

        book_slug = book_slug_map.get(book_abbr, book_abbr.lower())
        return f"{self.audio_base_url}/{book_slug}-{chapter_number}.mp3"

    def is_production(self) -> bool:
        """프로덕션 환경 여부 확인"""
        return os.getenv('ENVIRONMENT', 'development').lower() == 'production'

    def get_wordpress_api_url(self) -> str:
        """WordPress REST API URL 반환"""
        return f"{self.wp_site_url.rstrip('/')}/wp-json/wp/v2"

    def __str__(self) -> str:
        """설정 정보 문자열 표현 (민감한 정보 제외)"""
        return f"""Config:
  Bible Text: {self.bible_text_path}
  Book Mappings: {self.book_mappings_path}
  Template: {self.template_path}
  Output Dir: {self.output_dir}
  Log Dir: {self.log_dir}
  WordPress Site: {self.wp_site_url}
  WordPress User: {self.wp_username}
  WordPress Category: {self.wp_base_category}
  WordPress Tag: {self.wp_base_tag}
  Post Status: {self.wp_default_status}
  Log Level: {self.log_level}
  Debug Mode: {self.debug}
  Environment: {'Production' if self.is_production() else 'Development'}"""


def main():
    """설정 테스트를 위한 메인 함수"""
    try:
        config = Config()
        print("✅ 설정이 성공적으로 로드되었습니다.")
        print(config)
    except ValueError as e:
        print(f"❌ 설정 오류: {e}")
        return 1
    except Exception as e:
        print(f"❌ 예상치 못한 오류: {e}")
        return 1

    return 0


if __name__ == "__main__":
    import sys
    sys.exit(main())
