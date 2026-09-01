require("dotenv").config({ path: `./.env.${process.env.NODE_ENV}` });
console.log("ENV", process.env.NODE_ENV);
let express = require("express");
const createError = require("http-errors");
const path = require("path");
const cookieParser = require("cookie-parser");
const engine = require("ejs");
const helmet = require("helmet");
const logger = require("morgan");
const homeRouter = require("./home/home.router");
const authRouter = require("./auth/auth.router");
const dashboardRouter = require("./dashboard/dashboard.router");
const chatRouter = require("./chat/chat.router");
const notificationsRouter = require("./notifications/notifications.router");
const { attachRealtime, getIo } = require("./chat/chat.realtime");
const { pool } = require("./infrastructure/database");
const { closeRedis } = require("./infrastructure/redis/redis.client");

const app = express();
const SHUTDOWN_MS = 15000;
let shuttingDown = false;

if (process.env.NODE_ENV === "production") {
  app.set("trust proxy", 1);
}

app.engine("ejs", engine.__express);
app.set("views", path.join(__dirname, "./views")); 
app.set("view engine", "ejs");

if (process.env.NODE_ENV === "development") {
    app.use(logger("dev"));
}

const cspOptions = {
    directives: {
        ...helmet.contentSecurityPolicy.getDefaultDirectives(),
        "default-src": [
            "'self'",
        ],
        "script-src-attr": ["'unsafe-inline'"],
        "script-src": [
            "'self'",
            "'unsafe-eval'",
            "data:",
            "*.google.com",
            "'unsafe-inline'",
            "*.googleapis.com"
        ],
        "img-src": ["'self'", "data:", "*.amazonaws.com"],
        "frame-src": ["'self'", "*.youtube.com"],
        "frame-ancestors": ["'self'"], // 외부 도메인에서 iframe으로 해당 사이트 띄우는 것 허용
        "connect-src": ["'self'", "ws:", "wss:"], // socket.io WebSocket
    },
};

app.use(
    helmet({
        contentSecurityPolicy: cspOptions,
        xssFilter: true,
    })
);

// // x-powerd-by blocking
app.disable("x-powered-by");

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));

app.use("/", homeRouter);
app.use("/auth", authRouter);
app.use("/dashboard", dashboardRouter);
app.use("/", chatRouter);
app.use("/", notificationsRouter);

// 라우터에서 처리되지 않을 시 404에러 포착
app.use(function (req, res, next) {
    next(createError(404));
});

// error handler
app.use(function (err, req, res, next) {
    if (req.app.get("env") === "development") {
        console.error("Global error handler message in development:", err);
    }

    res.locals.message = err.message;
    res.locals.error = req.app.get("env") === "development" ? err : {};

    res.status(err.status || 500);
    res.render("error");
});

const debug = require("debug")("gen:server");
let http = require("http");

const PORT = process.env.SERVICE_PORT || 3000;
app.set("port", PORT);

const server = http.createServer(app);

(async () => {
  await attachRealtime(server);

  // SQS 클라이언트 워밍 (실패해도 앱은 폴백 푸시로 동작)
  require("./infrastructure/sqs/sqs.client").getSqsClient();

  server.listen(PORT);
  server.on("error", onError);
  server.on("listening", onListening);
})().catch((error) => {
  console.error("[boot] failed:", error);
  process.exit(1);
});

function onError(error) {
  if (error.syscall !== "listen") {
    throw error;
  }
  const bind = typeof PORT === "number" ? `Port ${PORT}` : `Pipe ${PORT}`;
  if (error.code === "EACCES") {
    console.error(`${bind} requires elevated privileges`);
    process.exit(1);
  }
  if (error.code === "EADDRINUSE") {
    console.error(`${bind} is already in use`);
    process.exit(1);
  }
  throw error;
}

function onListening() {
    if (process.env.NODE_ENV === "development") {
        console.log(`http://${process.env.DOMAIN}:${PORT}`);
    } else if (process.env.NODE_ENV === "production") {
        console.log(`https://${process.env.DOMAIN}:${PORT}`);
    }

    let addr = server.address();
    debug("Listening port: " + addr.port);
}

async function closeHttp() {
  const io = getIo();
  if (io) {
    await new Promise((resolve) => io.close(() => resolve()));
  } else if (server.listening) {
    await new Promise((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
  if (typeof server.closeIdleConnections === "function") {
    server.closeIdleConnections();
  }
}

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  app.set("shuttingDown", true);
  console.log(`[shutdown] ${signal}`);

  const timer = setTimeout(() => {
    console.error("[shutdown] timeout");
    process.exit(1);
  }, SHUTDOWN_MS);
  timer.unref();

  try {
    await closeHttp();
    await closeRedis();
    await pool.end();
    process.exit(0);
  } catch (error) {
    console.error("[shutdown] error:", error.message);
    process.exit(1);
  }
}

process.on("SIGTERM", () => {
  shutdown("SIGTERM");
});
process.on("SIGINT", () => {
  shutdown("SIGINT");
});
