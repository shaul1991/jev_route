# jev_route

Oh My Pi(OMP)의 Jev router extension과 macOS 설치 도구입니다.

## 제공 기능

- 사용자 요청을 Jev의 `ALM role` / `work type` / `FAST|NORMAL|DEEP`로 분류해 OMP 모델 역할을 선택.
- routing decision, 적용 모델, audit 결과를 프로필별 JSONL로 기록.
- `/jev roles`, `/jev roles routes`, `/jev log [n]`으로 역할 경로와 기록을 확인.
- **observe-only Tool Risk Gate**: 위험 신호가 있는 `bash` 호출을 분류하지만 실행을 차단·수정·지연하지 않음.

Tool Risk Gate는 원문 command, 경로, 파일 내용, 인자값을 Jev에 전송하거나 로그에 남기지 않습니다. 로컬에서 만든 위험 신호와 명령 길이만 전송합니다. 시크릿 가능성이 있으면 Jev API 호출 없이 로컬 기록만 남깁니다.

## 설치

```bash
git clone https://github.com/shaul1991/jev_route.git
cd jev_route
./scripts/install.sh
```

명시적으로 OMP profile을 지정하려면:

```bash
./scripts/install.sh omp-media
```

## TypeSafe API key

API key는 Git·환경 파일에 저장하지 않습니다. macOS Keychain에만 저장합니다.

```bash
printf '%s' "$TYPESAFE_API_KEY" | ./scripts/store-key.sh
```

macOS Keychain은 SSH daemon처럼 GUI 세션이 없는 프로세스의 쓰기를 거부할 수 있습니다. 대상 Mac의 **로그인한 GUI terminal**에서 key를 표준 입력으로 전달해 저장하세요. command argument나 repository에 키를 넣지 마세요.

```bash
printf '%s' '<TypeSafe API key>' | ~/personal/shaul1991/jev_route/scripts/store-key.sh
```

## 실행

```bash
~/.local/bin/omp-jev
```

launcher는 실행 때 Keychain에서 `TYPESAFE_API_KEY`를 읽고 다음 기본값을 설정합니다.

```text
JEV_ROUTER_MODE=active
JEV_TOOL_RISK_MODE=observe
```

다르게 실행하려면 환경 변수로 덮어쓸 수 있습니다.

```bash
JEV_ROUTER_MODE=observe ~/.local/bin/omp-jev
JEV_TOOL_RISK_MODE=off ~/.local/bin/omp-jev
```

## OMP 명령

```text
/jev roles          # Jev routing role과 실제 OMP 모델 배정 확인
/jev roles routes   # ALM 분류 → 역할 후보 순서 전체 보기
/jev log 20         # 요청, Jev 판단, 배정 모델 최근 20건
/jev risk           # observe-only bash 위험 관찰 최근 기록
```

## 로그

로그는 `PI_CODING_AGENT_DIR`를 우선 사용하므로 named profile끼리 섞이지 않습니다.

```text
<agent-dir>/jev-router.decisions.jsonl
<agent-dir>/jev-router.audits.jsonl
<agent-dir>/jev-tool-risk.audits.jsonl
<agent-dir>/jev-router.policies.json
```

기본 profile의 `<agent-dir>`은 `~/.omp/agent`입니다. `omp-media` 같은 named profile은 `~/.omp/profiles/<profile>/agent`입니다.
