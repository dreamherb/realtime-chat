require("dotenv").config({ path: `./.env.${process.env.NODE_ENV}` });
console.log("ENV", process.env.NODE_ENV);
let express = require("express");
const createError = require("http-errors");
const path = require("path");
const cookieParser = require("cookie-parser");
const engine = require("ejs");
const helmet = require("helmet");
const logger = require("morgan");
const bodyParser = require("body-parser");
const indexRouter = require("./router/index");

const app = express();

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
        ],
        "img-src": ["'self'", "data:", "*.amazonaws.com"],
        "frame-src": ["'self'", "*.youtube.com"],
        "frame-ancestors": ["'self'"], // 외부 도메인에서 iframe으로 해당 사이트 띄우는 것 허용
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

app.use(express.json({ limit: "5mb" })); // 미설정 시 디폴트 값 0.1mb
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));
app.use(bodyParser.json({ limit: 10000000 })); // 10 mb

// 크롬 개발자 도구 에러 로그 방지
app.get('/.well-known/appspecific/com.chrome.devtools.json', (req, res) => {
    res.status(204).end(); // No Content
});

app.use("/", indexRouter);

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

server.listen(PORT);
server.on("error", onError);
server.on("listening", onListening);

function onError(error) { }

function onListening() {
    if (process.env.NODE_ENV === "development") {
        console.log(`http://${process.env.DOMAIN}:${PORT}`);
    } else if (process.env.NODE_ENV === "production") {
        console.log(`https://${process.env.DOMAIN}:${PORT}`);
    }

    let addr = server.address();
    debug("Listening port: " + addr.port);
}
