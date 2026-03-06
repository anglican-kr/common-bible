# 디자인 시스템

공동번역성서 PWA의 디자인 시스템 명세입니다. 모든 UI 컴포넌트는 이 문서에 정의된 디자인 토큰과 원칙을 따릅니다.

## 📐 디자인 원칙

### 핵심 가치

1. **접근성 우선**: 모든 사용자가 성서 본문에 쉽게 접근할 수 있어야
2. **가독성 극대화**: 긴 텍스트를 편안하게 읽을 수 있는 타이포그래피
3. **오프라인 최적화**: 네트워크 상태와 무관하게 일관된 경험 제공
4. **최소한의 인지 부하**: 직관적인 네비게이션과 명확한 정보 계층

### UX 원칙

- **Progressive Disclosure**: 필요한 정보만 단계적으로 노출
- **Consistent Navigation**: 모든 페이지에서 일관된 네비게이션 제공
- **Responsive Design**: 모바일부터 데스크톱까지 최적화된 경험
- **Offline-First**: 오프라인 상태를 예외가 아닌 기본 시나리오로 설계

## 🎨 컬러 시스템

### 기본 팔레트

#### Primary (주 색상)

```css
--color-primary-900: #1a365d; /* 매우 진한 파랑 */
--color-primary-700: #2c5282; /* 진한 파랑 */
--color-primary-500: #3182ce; /* 기본 파랑 */
--color-primary-300: #63b3ed; /* 밝은 파랑 */
--color-primary-100: #bee3f8; /* 매우 밝은 파랑 */
```

#### Secondary (보조 색상)

```css
--color-secondary-900: #744210; /* 진한 황금 */
--color-secondary-700: #975a16; /* 황금 */
--color-secondary-500: #d69e2e; /* 기본 황금 */
--color-secondary-300: #f6e05e; /* 밝은 황금 */
--color-secondary-100: #fefcbf; /* 매우 밝은 황금 */
```

#### Neutral (중립 색상)

```css
--color-gray-900: #1a202c; /* 거의 검정 */
--color-gray-700: #2d3748; /* 진한 회색 */
--color-gray-500: #718096; /* 중간 회색 */
--color-gray-300: #cbd5e0; /* 밝은 회색 */
--color-gray-100: #f7fafc; /* 매우 밝은 회색 */
```

#### Semantic (의미론적 색상)

```css
--color-success: #38a169; /* 성공 (녹색) */
--color-warning: #d69e2e; /* 경고 (황금) */
--color-error: #e53e3e; /* 오류 (빨강) */
--color-info: #3182ce; /* 정보 (파랑) */
```

### 다크 모드 팔레트

```css
/* 다크 모드 오버라이드 */
@media (prefers-color-scheme: dark) {
  --color-bg-primary: #1a202c;
  --color-bg-secondary: #2d3748;
  --color-text-primary: #f7fafc;
  --color-text-secondary: #cbd5e0;
  --color-border: #4a5568;
}
```

### 사용 지침

| 용도          | 라이트 모드             | 다크 모드               | 설명        |
| ------------- | ----------------------- | ----------------------- | ----------- |
| 배경 (기본)   | `#ffffff`               | `--color-gray-900`      | 본문 배경   |
| 배경 (보조)   | `--color-gray-100`      | `--color-gray-700`      | 카드, 패널  |
| 텍스트 (기본) | `--color-gray-900`      | `--color-gray-100`      | 본문 텍스트 |
| 텍스트 (보조) | `--color-gray-700`      | `--color-gray-300`      | 부가 정보   |
| 링크          | `--color-primary-700`   | `--color-primary-300`   | 링크, 버튼  |
| 강조          | `--color-secondary-500` | `--color-secondary-300` | 하이라이트  |

## 📝 타이포그래피

### 폰트 패밀리

```css
/* 본문 텍스트 (세리프) */
--font-serif: "Noto Serif KR", "Noto Serif", Georgia, serif;

/* UI 요소 (산세리프) */
--font-sans: "Noto Sans KR", "Noto Sans", -apple-system, BlinkMacSystemFont, "Segoe UI",
  Roboto, "Helvetica Neue", Arial, sans-serif;

/* 절 번호, 코드 (모노스페이스) */
--font-mono: "Roboto Mono", "Courier New", monospace;
```

### 폰트 크기 스케일

```css
--text-xs: 0.75rem; /* 12px - 메타 정보 */
--text-sm: 0.875rem; /* 14px - 보조 텍스트 */
--text-base: 1rem; /* 16px - 기본 본문 */
--text-lg: 1.125rem; /* 18px - 본문 (모바일) */
--text-xl: 1.25rem; /* 20px - 소제목 */
--text-2xl: 1.5rem; /* 24px - 제목 */
--text-3xl: 1.875rem; /* 30px - 큰 제목 */
--text-4xl: 2.25rem; /* 36px - 페이지 제목 */
```

### 줄 높이

```css
--leading-tight: 1.25; /* 제목용 */
--leading-normal: 1.5; /* UI 텍스트 */
--leading-relaxed: 1.75; /* 본문 텍스트 (권장) */
--leading-loose: 2; /* 시각 장애인 모드 */
```

### 폰트 굵기

```css
--font-normal: 400; /* 본문 */
--font-medium: 500; /* 강조 */
--font-semibold: 600; /* 소제목 */
--font-bold: 700; /* 제목 */
```

### 타이포그래피 적용 예시

| 요소             | 폰트  | 크기          | 굵기     | 줄높이  |
| ---------------- | ----- | ------------- | -------- | ------- |
| 페이지 제목 (h1) | Sans  | `--text-3xl`  | Bold     | Tight   |
| 섹션 제목 (h2)   | Sans  | `--text-2xl`  | Semibold | Tight   |
| 본문 텍스트      | Serif | `--text-base` | Normal   | Relaxed |
| 절 번호          | Mono  | `--text-sm`   | Medium   | Normal  |
| 버튼 텍스트      | Sans  | `--text-base` | Medium   | Normal  |
| 보조 정보        | Sans  | `--text-sm`   | Normal   | Normal  |

## 📏 간격 시스템 (Spacing)

### 스케일

```css
--space-0: 0;
--space-1: 0.25rem; /* 4px */
--space-2: 0.5rem; /* 8px */
--space-3: 0.75rem; /* 12px */
--space-4: 1rem; /* 16px */
--space-5: 1.25rem; /* 20px */
--space-6: 1.5rem; /* 24px */
--space-8: 2rem; /* 32px */
--space-10: 2.5rem; /* 40px */
--space-12: 3rem; /* 48px */
--space-16: 4rem; /* 64px */
```

### 사용 지침

| 용도                      | 간격                        | 예시         |
| ------------------------- | --------------------------- | ------------ |
| 컴포넌트 내부 패딩 (작음) | `--space-2` ~ `--space-3`   | 버튼 내부    |
| 컴포넌트 내부 패딩 (보통) | `--space-4` ~ `--space-6`   | 카드 내부    |
| 컴포넌트 간 간격 (작음)   | `--space-4`                 | 연관된 요소  |
| 컴포넌트 간 간격 (보통)   | `--space-6` ~ `--space-8`   | 독립된 요소  |
| 섹션 간 간격              | `--space-12` ~ `--space-16` | 큰 섹션 구분 |
| 본문 단락 간격            | `--space-4`                 | 절 사이      |

## 🎯 레이아웃

### 컨테이너 최대 너비

```css
--container-sm: 640px; /* 모바일 콘텐츠 */
--container-md: 768px; /* 태블릿 */
--container-lg: 1024px; /* 본문 최적 너비 */
--container-xl: 1280px; /* 와이드 레이아웃 */
```

### 브레이크포인트

```css
--breakpoint-sm: 640px; /* 스마트폰 */
--breakpoint-md: 768px; /* 태블릿 */
--breakpoint-lg: 1024px; /* 노트북 */
--breakpoint-xl: 1280px; /* 데스크톱 */
```

### 레이아웃 그리드

```css
/* 모바일 (<768px) */
--grid-columns: 1;
--grid-gap: var(--space-4);

/* 태블릿 (768-1024px) */
--grid-columns: 2;
--grid-gap: var(--space-6);

/* 데스크톱 (>1024px) */
--grid-columns: 3;
--grid-gap: var(--space-8);
```

## 🔘 컴포넌트 명세

### 버튼

#### 크기

```css
/* 작은 버튼 */
.btn-sm {
  padding: var(--space-2) var(--space-3);
  font-size: var(--text-sm);
  border-radius: 0.375rem; /* 6px */
}

/* 기본 버튼 */
.btn {
  padding: var(--space-3) var(--space-4);
  font-size: var(--text-base);
  border-radius: 0.5rem; /* 8px */
  min-height: 44px; /* 터치 영역 */
  min-width: 44px;
}

/* 큰 버튼 */
.btn-lg {
  padding: var(--space-4) var(--space-6);
  font-size: var(--text-lg);
  border-radius: 0.5rem; /* 8px */
}
```

#### 변형

- **Primary**: 주요 액션 (검색, 이동 등)
- **Secondary**: 보조 액션 (닫기, 취소 등)
- **Ghost**: 텍스트 버튼 (링크형)
- **Outline**: 외곽선 버튼 (선택 옵션)

### 입력 필드

```css
.input {
  padding: var(--space-3) var(--space-4);
  font-size: var(--text-base);
  border: 1px solid var(--color-gray-300);
  border-radius: 0.5rem;
  min-height: 44px; /* 터치 영역 */
}

.input:focus {
  outline: 2px solid var(--color-primary-500);
  outline-offset: 2px;
}
```

### 카드

```css
.card {
  padding: var(--space-6);
  background: var(--color-bg-secondary);
  border-radius: 0.75rem; /* 12px */
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}

.card:hover {
  box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
}
```

### 모달/드로어

```css
/* 모바일: 바텀시트 */
@media (max-width: 768px) {
  .modal {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    max-height: 80vh;
    border-radius: 1rem 1rem 0 0;
  }
}

/* 데스크톱: 중앙 모달 */
@media (min-width: 769px) {
  .modal {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    max-width: 600px;
    border-radius: 1rem;
  }
}
```

## ♿️ 접근성 (Accessibility)

### 최소 터치 영역

- 모든 인터랙티브 요소: **44x44px** (WCAG 권장)
- 모바일 환경: **48x48px** (Google Material 권장)

### 색상 대비

- 본문 텍스트: **최소 4.5:1** (WCAG AA)
- 큰 텍스트 (18px+): **최소 3:1**
- UI 요소: **최소 3:1**

### 포커스 상태

```css
:focus-visible {
  outline: 2px solid var(--color-primary-500);
  outline-offset: 2px;
}
```

### 스크린리더 전용 텍스트

```css
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
```

## 🎭 애니메이션 & 전환

### 지속 시간

```css
--duration-fast: 150ms; /* 빠른 피드백 */
--duration-normal: 250ms; /* 기본 전환 */
--duration-slow: 350ms; /* 복잡한 애니메이션 */
```

### 이징 함수

```css
--ease-in: cubic-bezier(0.4, 0, 1, 1);
--ease-out: cubic-bezier(0, 0, 0.2, 1);
--ease-in-out: cubic-bezier(0.4, 0, 0.2, 1);
```

### 사용 예시

```css
/* 호버 효과 */
.interactive {
  transition: all var(--duration-fast) var(--ease-out);
}

/* 모달 등장 */
.modal-enter {
  animation: slideUp var(--duration-normal) var(--ease-out);
}

/* 접근성: 애니메이션 감소 선호 사용자 */
@media (prefers-reduced-motion: reduce) {
  * {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

## 🌓 다크 모드 전환

### 자동 감지

```css
@media (prefers-color-scheme: dark) {
  /* 다크 모드 스타일 */
}
```

### 수동 토글 (선택사항)

```html
<button id="theme-toggle" aria-label="다크 모드 전환">
  <span class="light-icon">🌙</span>
  <span class="dark-icon">☀️</span>
</button>
```

## 📦 디자인 토큰 내보내기

JSON 형식으로 디자인 토큰을 관리하려면 다음 파일을 참조:

- 추후 `tokens/design-tokens.json` 생성 예정 (선택사항)

## 🔗 관련 문서

- [요구사항 명세](prd.md)
- [와이어프레임](wireframes.md)
- [접근성 가이드라인](prd.md#♿️-시각-장애인을-위한-접근성-요구사항)
- [UX API 명세](api.md) (Web Worker 메시지 규격)
