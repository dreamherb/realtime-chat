# Realtime Chat

이메일 기반 1:1·단체 실시간 채팅 서비스.

- 사이트: [https://dream-herb.com](https://dream-herb.com)

## 주요 특징

- 이메일 회원가입, 비밀번호 찾기 시 이메일 인증
- 존재하는 이메일에 한해 1:1 또는 단체방 생성 후 채팅
- PC·모바일 각각 1대씩만 로그인 (같은 플랫폼으로 재로그인하면 기존 세션 폐기)
- PC 알림 On 시 새 메시지 Web Push
- 짧은 시간에 메시지를 반복 입력하면 5초 입력 제한
- 발송 중 네트워크가 끊겨도 IndexedDB에 보관하고, 재연결 시 재발송

## 기술 스택

| 구분 | 사용 |
| --- | --- |
| Runtime | Node.js, Express.js |
| Realtime | Socket.IO |
| View | EJS, CSS |
| Data | MySQL (RDS), Valkey/Redis |
| Queue | Amazon SQS (로컬은 ElasticMQ) |
| Push / Mail | Web Push, SMTP (Nodemailer) |
| Infra | Docker, EC2, ECR, ALB, ASG |
| Test | Jest, supertest |
| CI/CD | GitHub Actions (OIDC) |

## 인프라

AWS VPC 프라이빗 서브넷에 EC2·RDS·ElastiCache(Valkey)를 두고, 인터넷에서 DB·앱 서버로 직접 접근하지 않는다. 사용자 트래픽은 퍼블릭 서브넷의 ALB(HTTPS)로만 들어오며, 앱 서버 보안 그룹은 ALB만 허용한다. 프라이빗 리소스의 외부 API 호출은 NAT Gateway를 경유한다.

배포는 GitHub Actions(OIDC)로 Docker 이미지를 ECR에 푸시한 뒤, SSM Run Command로 EC2에 반영한다. `main` 푸시 또는 수동 실행으로 배포하며, 환경 변수는 SSM Parameter Store 값을 사용한다. 리소스 증감은 Auto Scaling으로 처리한다.

```
Client ──HTTPS──► ALB ──► EC2 (app / worker)
                         │
                         ├── RDS (MySQL)
                         ├── ElastiCache (Valkey)
                         └── SQS
```

## 코드 구조

도메인별로 폴더를 나누고, 각 도메인은 `router → controller → service` 흐름을 따른다. 외부 시스템(DB, Redis, SQS, SMTP)은 `infrastructure/`에 모은다.

```
realtime-chat/
├── app.js                      # Express 부트스트랩, Socket.IO 연결, graceful shutdown
├── __tests__/
│   ├── unit/                   # crypto, 세션 플랫폼, 방 미리보기
│   └── integration/            # /health, 회원가입·로그인 (supertest)
├── jest.config.js
├── jest.integration.config.js
├── jest.setup.js
├── auth/                       # 회원가입·로그인·세션·비밀번호 재설정
│   ├── auth.router.js
│   ├── auth.controller.js
│   ├── auth.service.js
│   ├── auth.sessions.js        # PC/모바일 세션 1개 제한, Valkey 캐시
│   ├── auth.middleware.js
│   ├── auth.crypto.js
│   └── password-reset.*
├── chat/                       # 방 생성/참여, 실시간 메시지, 푸시 발행
│   ├── chat.router.js
│   ├── chat.controller.js
│   ├── chat.service.js
│   ├── chat.realtime.js        # Socket.IO 핸들러, Redis adapter, 입력 제한
│   └── chat.push.js
├── dashboard/                  # 로그인 후 채팅 UI
├── home/                       # 루트, health check
├── notifications/              # Web Push 구독·알림 설정
├── workers/
│   └── chat-message.worker.js  # SQS long poll → 오프라인 푸시
├── infrastructure/
│   ├── database.js             # MySQL pool
│   ├── mail/                   # SMTP
│   ├── redis/                  # 클라이언트, presence
│   └── sqs/                    # producer / client, ElasticMQ 설정
├── public/                     # 정적 자산, 클라이언트 JS, service worker
│   ├── js/
│   │   ├── dashboard.js
│   │   ├── chat-outbox.js      # IndexedDB 오프라인 재발송
│   │   └── chat-notify.js
│   └── sw.js
├── views/                      # EJS 템플릿
├── docker-compose.yml          # app + worker
├── docker-compose.local.yml    # Redis, ElasticMQ, 로컬 MySQL(호스트)
├── docker-compose.prod.yml
└── .github/workflows/deploy.yml
```

### 요청 흐름

| 경로 | 역할 |
| --- | --- |
| `/` | 홈 / 로그인 리다이렉트 |
| `/auth/*` | 로그인, 회원가입, 로그아웃, 비밀번호 찾기 |
| `/dashboard` | 채팅 목록·대화 |
| `/chats/new`, `/groups/new` | 1:1·단체방 생성 |
| `/api/rooms` | 방 생성, 참여, 나가기 |
| `/notifications`, `/api/push/*` | 알림 설정, Web Push 구독 |
| `/health` | 헬스체크 (종료 중이면 503) |

채팅 메시지 송수신은 HTTP가 아니라 Socket.IO 이벤트(`message:send`, `message:new` 등)로 처리한다.

## 데이터 모델

| 테이블 | 역할 |
| --- | --- |
| `users` | 회원, 푸시 알림 On/Off |
| `users_sessions` | 기기·플랫폼별 로그인 세션 (`token_jti`) |
| `email_auth_number` | 비밀번호 찾기 인증 코드 |
| `chat_rooms` | `DM` / `GROUP` |
| `chat_room_members` | 방 멤버, 마지막 읽은 메시지 |
| `messages` | 본문, `client_msg_id` (재발송 중복 방지) |
| `push_subscriptions` | Web Push 구독 정보 |

## 설계 포인트

### Web Push를 SQS로 분리

채팅 저장·브로드캐스트와 푸시를 같은 경로에 두면, 푸시 HTTP 지연이 채팅 응답을 잡아먹는다. 메시지 발송 시 오프라인 알림 이벤트만 SQS에 넣고, 워커가 long poll로 소비한다. 성공 시에만 큐에서 삭제해 장애 시 재처리한다. 웹(app)과 워커는 별도 컨테이너라 트래픽이 늘면 채팅과 푸시를 따로 키울 수 있다. SQS가 없거나 발행에 실패하면 기존 동기 푸시로 폴백한다.

```
Client → app → RDS 저장 → Socket.IO 브로드캐스트 (온라인)
                 └─ SQS 발행 → worker → Web Push (오프라인)
```

채팅 ack는 푸시 완료를 기다리지 않는다.

### Socket.IO 상태를 Valkey로 공유

기본 in-memory adapter는 프로세스 RAM에 room/socket 매핑을 둔다. 재시작 시 접속 상태가 사라지고, ASG처럼 인스턴스가 여러 개면 서로 소켓을 모른다. `@socket.io/redis-adapter`로 Valkey Pub/Sub을 쓰면 인스턴스 간에 `message:new`가 전달된다. 온라인 여부는 `infrastructure/redis/redis.presence.js`에서 connection refcount로 관리한다.

### 로그인 세션

쿠키 JWT만 있으면 서버가 특정 기기를 끊거나, PC/모바일 1대 제한을 걸기 어렵다. 로그인 시 `users_sessions`에 저장하고 Valkey(`session:jti:{jti}`)에 캐시한다. HTTP와 Socket handshake 모두 이 세션을 검증한다. 캐시 miss면 DB를 보고 다시 캐시한다.

## 로컬 실행

Node 로컬 + Docker 인프라, 또는 compose로 app/worker까지 띄울 수 있다. MySQL은 호스트에서 돌리고, Redis·SQS(ElasticMQ)는 Docker를 쓴다.

```bash
# 인프라만
yarn infra:up

# 앱 / 워커 (호스트 Node)
yarn dev
yarn worker:chat

# 앱·워커까지 Docker
yarn local:up
yarn local:logs
yarn local:down
```

환경 변수는 `.env.development` / `.env.production`을 사용한다. (`.env.*`는 git에 포함하지 않는다.)

## 테스트

Jest를 쓴다. 단위 테스트는 DB 없이 돌리고, 통합 테스트는 로컬 MySQL과 `.env.development`가 필요하다.

```bash
yarn test            # 단위 (__tests__/unit)
yarn test:int        # 통합 (__tests__/integration)
yarn test:coverage   # 통합 + coverage
```

통합 테스트는 고유 이메일로 가입·로그인 후 해당 유저만 삭제한다. `app.js`는 직접 실행할 때만 listen하므로, 테스트에서 require해도 포트를 열지 않는다.

## 배포

`main` 푸시 또는 Actions 수동 실행.

1. GitHub OIDC로 AWS 인증
2. `linux/arm64` 이미지를 ECR에 푸시 (Graviton EC2)
3. SSM Parameter Store에 이미지 URI·환경 변수 반영
4. SSM Run Command로 EC2 compose 재기동
