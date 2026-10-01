#!/usr/bin/env bash
# qzda-skill-runtime docker entrypoint.
#
# 职责：
# 1. 探测容器是否真的跑在 gVisor (runsc) 运行时下
# 2. 若运行时是 runsc、且本机装了 /usr/local/bin/runsc、设置 DE_SKILL_RUNTIME_DETECTED
# 3. 解析 DE_SKILL_SANDBOX：声明的能力 (runsc | gvisor-local) 与实际能力求交集
# 4. 透传到 uvicorn
#
# 检测方法：
# - /proc/1/cmdline 含 "runsc"            → runsc-ptrace
# - /proc/1/cmdline 含 "runsc-kvm"        → runsc-kvm
# - /proc/1/cmdline 含 "runc"             → runc
# - /proc/1/cgroup path 含 "docker" 但都不是 → 兜底为 process
set -euo pipefail

log() { echo "[entrypoint] $*" >&2; }

detect_runtime() {
  local cmdline=""
  if [[ -r /proc/1/cmdline ]]; then
    cmdline="$(tr '\0' ' ' < /proc/1/cmdline 2>/dev/null || true)"
  fi

  if [[ -x /usr/local/bin/runsc ]]; then
    if [[ "$cmdline" == *"runsc-kvm"* ]]; then
      echo "runsc-kvm"
      return
    fi
    if [[ "$cmdline" == *"runsc"* ]]; then
      echo "runsc-ptrace"
      return
    fi
  fi

  if [[ "$cmdline" == *"runc"* ]]; then
    echo "runc"
    return
  fi

  echo "process"
}

requested="${DE_SKILL_SANDBOX:-gvisor-local}"
actual="$(detect_runtime)"
export DE_SKILL_RUNTIME_DETECTED="$actual"

case "$requested:$actual" in
  runsc:runsc-kvm)
    export DE_SKILL_SANDBOX="runsc"          # 强隔离，KVM 加速
    ;;
  runsc:runsc-ptrace)
    export DE_SKILL_SANDBOX="runsc"          # 强隔离，ptrace 后端
    ;;
  runsc:runc)
    export DE_SKILL_SANDBOX="runsc-emulated" # 声明 runsc 但 host 是 runc
    ;;
  runsc:process)
    export DE_SKILL_SANDBOX="runsc-emulated"
    ;;
  gvisor-local:*)
    export DE_SKILL_SANDBOX="gvisor-local"   # 进程级 + Docker 网络兜底
    ;;
  *)
    export DE_SKILL_SANDBOX="$requested"
    ;;
esac

log "DE_SKILL_SANDBOX=${DE_SKILL_SANDBOX} requested=${requested} runtime=${actual}"

# exec 通过 tini 做 PID 1 信号转发
exec tini -- "$@"