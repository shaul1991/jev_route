# jev_route

Oh My Pi(OMP)의 Jev router extension과 Claude Code 플러그인, macOS 설치 도구입니다.

## 제공 기능

- 사용자 요청을 Jev의 `ALM role` / `work type` / 5단계 작업 깊이로 분류합니다. OMP에서는 결과를 역할 alias와 thinking level로 연결.
- routing decision, 적용 모델, audit 결과를 프로필별 JSONL로 기록.
- `/jev roles`, `/jev roles routes`, `/jev log [n]`으로 역할 경로와 기록을 확인.
- **observe-only Tool Risk Gate**: 위험 신호가 있는 `bash` 호출을 분류하지만 실행을 차단·수정·지연하지 않음.

Tool Risk Gate는 원문 command, 경로, 파일 내용, 인자값을 Jev에 전송하거나 로그에 남기지 않습니다. 로컬에서 만든 위험 신호와 명령 길이만 전송합니다. 시크릿 가능성이 있으면 Jev API 호출 없이 로컬 기록만 남깁니다.

## 5단계 라우팅과 OMP model role

| 단계 | 의미 | OMP model role 후보 | Thinking |
| --- | --- | --- | --- |
| `TRIVIAL` | 읽기 전용 또는 즉시 되돌릴 수 있는 사소한 작업 | `@tiny` → `@smol` → `@default` | minimal |
| `FAST` | 범위가 좁고 명확한 저위험 변경 | 작업별 light 후보 중 첫 alias | low |
| `NORMAL` | 일반적인 구현과 표준 검증 | 작업별 전체 light 후보 | medium |
| `DEEP` | 원인 불명, 다중 파일 설계, migration, concurrency, public contract | 작업별 deep 후보 | high |
| `CRITICAL` | 인증·결제·민감 데이터·운영·비가역 고영향 변경 | `@slow` 우선, 이후 작업별 deep 후보 | xhigh |

`TRIVIAL`은 Jev 신뢰도 0.95 미만이면 `NORMAL`, `FAST`는 0.9 미만이면 `NORMAL`로 승격됩니다. 기본 정책은 schema 변경을 최소 `NORMAL`, 인증·권한과 결제·민감 데이터 변경을 `CRITICAL`, concurrency·public contract·broad refactor를 `DEEP`로 올립니다. `CRITICAL`은 더 강한 모델·추론 경로를 고르는 분류일 뿐, tool 실행을 막거나 승인하는 보안 경계는 아닙니다.

각 `@alias`는 OMP의 활성 profile `modelRoles`에서 실제 모델에 매핑되어야 합니다. `@tiny`, `@smol`, `@default`, `@slow`와 작업별 alias(`@build`, `@test`, `@security` 등)를 구성한 뒤 `/jev roles`로 해석 가능 여부를 확인하세요. `/jev roles routes`는 다섯 단계의 후보 순서를 표시합니다. 사용자 지정은 `@jev:trivial`, `@jev:fast`, `@jev:normal`, `@jev:deep`, `@jev:critical`; 자동 분류는 `@jev:auto`입니다.

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

## 플랫폼별 설정

- `config/omp.json`: OMP의 작업별 light/deep role 후보, 5단계 기본 role, thinking level을 설정합니다. 후보는 활성 profile의 `modelRoles`에 정의된 alias 이름이며 provider/model ID를 직접 지정하지 않습니다. 설치 시 `<agent-dir>/config/omp.json`으로 복사됩니다. 수정한 뒤 `./scripts/install.sh [profile]`을 다시 실행하세요.
- `config/claude.json`: Claude hook의 `enabled`와 `maxPromptChars`를 설정합니다. 최대 prompt 길이는 공통 안전 한도보다 커질 수 없습니다. 이 설정은 분류 advisory를 조절할 뿐 Claude의 모델이나 agent를 선택하지 않습니다.

## Claude Code (advisory)

저장소 루트가 Claude Code plugin입니다. 개발·로컬 사용 시:

```bash
claude --plugin-dir "$PWD"
```

`TYPESAFE_API_KEY` 환경변수가 설정되어 있어야 합니다. Claude Code의 `UserPromptSubmit` hook이 사용자 요청을 Jev에 분류 요청으로 보내고, 결과를 `additionalContext`로 전달합니다. 코드 블록, 2,000자를 초과하는 요청, API key·secret·password·private key 형태가 감지된 요청은 전송하지 않습니다. 키가 없거나 Jev 호출이 실패하면 hook은 아무 context도 추가하지 않고 원래 Claude 동작을 유지합니다.

이 adapter는 **advisory only**입니다. Claude Code의 현재 세션 모델을 hook에서 자동 변경하지 않습니다. 기존 모델을 유지하며 Jev의 role/work/mode 분류를 참고 정보로 제공합니다. OMP adapter처럼 실제 모델 배정을 제어하지 않습니다. 현재 OMP에 저장한 승인 routing policy도 Claude adapter에는 적용되지 않습니다.

Claude plugin은 `UserPromptSubmit` hook을 사용하므로 Node.js 18 이상이 필요합니다. 프로젝트가 plugin hook 실행을 허용하는지 확인한 뒤 사용하세요.

`TYPESAFE_API_KEY`는 셸에 이미 설정된 경우 그대로 전달할 수 있습니다. 키를 명령 기록에 남기지 않으려면:

```bash
read -rs 'TYPESAFE_API_KEY?TypeSafe API key: '
printf '\n'
export TYPESAFE_API_KEY
claude --plugin-dir "$PWD"
```

## TypeSafe API key

API key는 Git·환경 파일에 저장하지 않습니다. launcher는 **`TYPESAFE_API_KEY` 환경변수 우선**,
없으면 macOS login Keychain의 `omp-typesafe` 항목을 읽습니다.

### SSH에서 저장 없이 실행

이미 현재 shell에 키를 입력했다면:

```bash
export TYPESAFE_API_KEY
~/.local/bin/omp-jev
```

새로 입력해야 한다면 macOS 기본 zsh에서 다음처럼 숨김 입력합니다.
키 자체를 명령에 적지 않아 shell history에 남기지 않습니다.

```zsh
read -rs 'TYPESAFE_API_KEY?TypeSafe API key: '
printf '\n'
export TYPESAFE_API_KEY
~/.local/bin/omp-jev
```

이 방식은 Keychain을 사용하지 않고 해당 shell과 자식 프로세스의 환경변수에만 키를 둡니다.
환경변수도 같은 사용자나 권한 있는 프로세스가 읽을 수 있으므로 공개 로그로 출력하지 마세요.

### Keychain에 영구 저장

`User interaction is not allowed`는 API key 인증 실패가 아니라 Keychain 접근 실패입니다.
GUI terminal에서도 login Keychain이 잠겨 있거나 접근 승인이 필요하면 발생할 수 있습니다.
먼저 대상 Mac의 터미널에서 대화형으로 잠금을 해제합니다(SSH는 `ssh -t <host>`로 터미널 확보).

```bash
security unlock-keychain "$HOME/Library/Keychains/login.keychain-db"
```

프롬프트에는 **login Keychain 비밀번호**(보통 Mac 로그인 비밀번호)를 입력합니다.
TypeSafe API key가 아닙니다. 비밀번호를 `-p` 인자로 넣거나 이 저장소에 저장하지 마세요.
잠금 해제 후, 키를 stdin으로 전달합니다.

```bash
printf '%s' "$TYPESAFE_API_KEY" | ./scripts/store-key.sh
```

저장 스크립트는 API key를 `security`의 프로세스 인자가 아닌 stdin으로 전달하고,
저장 후 다시 읽어 일치하는지 확인합니다. Keychain 잠금이나 ACL이 계속 접근을 막으면
로컬 Keychain Access에서 상태를 확인하거나 위 환경변수 실행 방식을 사용하세요.
모든 프로그램에 접근을 허용하는 `-A` 옵션은 사용하지 않습니다.

## 실행

```bash
~/.local/bin/omp-jev
```

launcher는 환경변수 또는 Keychain에서 `TYPESAFE_API_KEY`를 읽고 다음 기본값을 설정합니다.

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
