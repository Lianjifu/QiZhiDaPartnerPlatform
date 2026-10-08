/* qzda-egress:把子进程所有非环回 IPv4 connect 重定向到 127.0.0.1:8081。
 *
 * 编译(参见 Dockerfile builder stage):
 *   gcc -O2 -fPIC -shared -o libqzda_egress.so libqzda_egress.c
 *
 * 加载:子进程 env 加 LD_PRELOAD=/app/lib/libqzda_egress.so。
 *
 * 行为:
 * 1. connect() 拦截:
 *    - dest 是 127.0.0.1/0.0.0.0/::1 → 原样放行(stdlib 内部 / unix socket 等)。
 *    - dest 是 IP literal 且在 env QZDA_SANDBOX_ALLOWED_EGRESS(CSV)里 → 原样放行。
 *    - 其他情况 → 改写为 127.0.0.1:8081,由 Python egress_proxy 按 allowlist 决策。
 *    - AF_INET6 直接放行(DNS-gate 已挡域名解析;IPv6 直连留作未来 iptables 层处理)。
 *
 * 2. getaddrinfo() 拦截:
 *    - 域名命中 allowlist → 原样返回。
 *    - 否则返回 EAI_FAIL(类似 DnsGate deny-all 语义,但发生在 stdlib 之前的 C 层,
 *      防止 Node fetch / curl 等不读 monkey-patch 的客户端硬编 IP 旁路)。
 *
 * 设计约束:
 * - 线程安全:env 读取在 connect/getaddrinfo 路径里只读,无锁。
 * - 不阻塞:connect 重定向后,真实 connect 失败时返回 -1 + ECONNREFUSED,
 *   客户端自然走错误路径。
 * - 不缓冲 / 不记录:审计/日志由 Python audit_hooks 负责,socket.connect 的
 *   拦截只做"policy redirect",不做 observation(避免与 audit_hooks 双计)。
 */
#define _GNU_SOURCE
#include <sys/socket.h>
#include <netinet/in.h>
#include <arpa/inet.h>
#include <netdb.h>
#include <dlfcn.h>
#include <stdlib.h>
#include <string.h>
#include <stdio.h>
#include <pthread.h>

/* ---- config snapshot (loaded once at .so init) -------------------------- */
static char *g_allowed_csv = NULL;   /* owned copy of $QZDA_SANDBOX_ALLOWED_EGRESS */
static int   g_deny_all = 0;         /* $QZDA_SANDBOX_DENY_ALL_EGRESS=1 → no allowed */
static pthread_once_t g_once = PTHREAD_ONCE_INIT;

static void load_config(void) {
    const char *csv = getenv("QZDA_SANDBOX_ALLOWED_EGRESS");
    const char *da  = getenv("QZDA_SANDBOX_DENY_ALL_EGRESS");
    if (csv) {
        size_t n = strlen(csv);
        g_allowed_csv = (char *)malloc(n + 1);
        if (g_allowed_csv) memcpy(g_allowed_csv, csv, n + 1);
    }
    g_deny_all = (da && da[0] == '1') ? 1 : 0;
}

static void ensure_loaded(void) {
    pthread_once(&g_once, load_config);
}

/* in_csv:是否在 CSV 白名单里?空 → 仅放行 127.0.0.1 / 0.0.0.0(已在 caller 检查) */
static int in_allowlist(const char *needle) {
    ensure_loaded();
    if (g_deny_all) return 0;
    if (!g_allowed_csv || !needle || !*needle) return 0;
    /* CSV 用 , 或 ; 分隔;去空白;小写比较。needle 已小写 */
    const char *p = g_allowed_csv;
    size_t nlen = strlen(needle);
    while (*p) {
        while (*p == ' ' || *p == '\t') p++;
        const char *q = p;
        while (*q && *q != ',' && *q != ';') q++;
        size_t seg_len = (size_t)(q - p);
        /* 去尾部空白 */
        while (seg_len > 0 && (p[seg_len - 1] == ' ' || p[seg_len - 1] == '\t')) seg_len--;
        if (seg_len == nlen && strncmp(p, needle, nlen) == 0) return 1;
        p = q;
        if (*p == ',' || *p == ';') p++;
    }
    return 0;
}

/* ---- connect() hook ------------------------------------------------- */
typedef int (*connect_fn_t)(int, const struct sockaddr *, socklen_t);

int connect(int sockfd, const struct sockaddr *addr, socklen_t addrlen) {
    static connect_fn_t rc = NULL;
    if (!rc) rc = (connect_fn_t)dlsym(RTLD_NEXT, "connect");

    if (addr && addr->sa_family == AF_INET) {
        struct sockaddr_in *sin = (struct sockaddr_in *)addr;
        char buf[INET_ADDRSTRLEN] = {0};
        if (!inet_ntop(AF_INET, &sin->sin_addr, buf, sizeof(buf))) {
            return rc(sockfd, addr, addrlen);
        }
        /* 放行环回 / 未指定 / 已在 allowlist 的 IP literal */
        if (strcmp(buf, "127.0.0.1") == 0 || strcmp(buf, "0.0.0.0") == 0) {
            return rc(sockfd, addr, addrlen);
        }
        if (in_allowlist(buf)) {
            return rc(sockfd, addr, addrlen);
        }
        /* 重定向到 127.0.0.1:8081,保留 sin_zero 与 sin_family / addrlen */
        struct sockaddr_in redir;
        memset(&redir, 0, sizeof(redir));
        redir.sin_family = AF_INET;
        redir.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
        redir.sin_port = htons(8081);
        /* 同样 sin_zero 已 0 */
        return rc(sockfd, (struct sockaddr *)&redir, sizeof(redir));
    }
    /* AF_INET6 / AF_UNIX / 其他 → 原样 */
    return rc(sockfd, addr, addrlen);
}

/* ---- getaddrinfo() hook -------------------------------------------- */
typedef int (*getaddrinfo_fn_t)(const char *, const char *,
                        const struct addrinfo *, struct addrinfo **);

int getaddrinfo(const char *node, const char *service,
               const struct addrinfo *hints, struct addrinfo **res) {
    static getaddrinfo_fn_t rg = NULL;
    if (!rg) rg = (getaddrinfo_fn_t)dlsym(RTLD_NEXT, "getaddrinfo");

    if (node && *node) {
        /* IP literal 直接放行(connect() 会再判定一次) */
        struct in_addr v4;
        struct in6_addr v6;
        if (inet_pton(AF_INET, node, &v4) == 1 || inet_pton(AF_INET6, node, &v6) == 1) {
            return rg(node, service, hints, res);
        }
        /* 域名:小写 + 比对 allowlist */
        char lower[256];
        size_t i;
        for (i = 0; i < 255 && node[i]; i++) {
            char c = node[i];
            if (c >= 'A' && c <= 'Z') c = (char)(c - 'A' + 'a');
            lower[i] = c;
        }
        lower[i] = '\0';
        if (!in_allowlist(lower)) {
            return EAI_FAIL;
        }
    }
    return rg(node, service, hints, res);
}