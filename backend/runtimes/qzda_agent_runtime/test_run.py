#!/usr/bin/env python3
"""Smoke tests for qzda-agent-runtime Run prompt helpers."""
from __future__ import annotations

import sys
from pathlib import Path

_SERVICE = Path(__file__).resolve().parents[2] / "services" / "qzda-agent-runtime"
if str(_SERVICE) not in sys.path:
    sys.path.insert(0, str(_SERVICE))

from app.llm import build_run_prompt, chunk_text  # noqa: E402
from app.loop import enabled_tools, iter_run_events, tool_events  # noqa: E402


def test_chunk_text() -> None:
    assert chunk_text("abcdefgh", 3) == ["abc", "def", "gh"]
    assert chunk_text("", 8) == []


def test_build_run_prompt() -> None:
    prompt = build_run_prompt(
        {
            "input": "hello",
            "snapshot": {"system": "you are a bot"},
            "enabledTools": ["knowledge.retrieve"],
        }
    )
    assert "you are a bot" in prompt
    assert "hello" in prompt
    assert "knowledge.retrieve" in prompt


def test_tool_loop_events() -> None:
    tools = enabled_tools({"enabledTools": ["knowledge.retrieve", "memory.recall"]})
    assert tools == ["knowledge.retrieve", "memory.recall"]
    evs = tool_events(tools, corr="c1", snap_id="s1", user_input="q", retrieve=lambda *a, **k: {"results": [{"docId": "d1"}], "backend": "test"})
    assert evs[0]["type"] == "tool"
    assert evs[0]["name"] == "knowledge.retrieve"
    assert evs[0]["hitCount"] == 1
    mem = tool_events(
        ["memory.recall"],
        corr="c1",
        snap_id="s1",
        user_input="q",
        snapshot={"memoryProvenance": [{"id": "m1", "title": "pref"}]},
    )
    assert mem[0]["name"] == "memory.recall" and mem[0]["status"] == "ok"
    skipped = tool_events(["skill.run"], corr="c1", snap_id="s1", user_input="q")
    assert skipped[0]["name"] == "skill.run" and skipped[0]["status"] == "skipped"
    types = [e["type"] for e in iter_run_events(
        corr="c1", snap_id="s1", model_id="m", text="hi",
        tools=tools, user_input="q", provider="stub", chunks=["hi"],
        retrieve=lambda *a, **k: {"results": []},
    )]
    assert types[0] == "stage"
    assert "tool" in types
    assert types[-2] == "delta"
    assert types[-1] == "done"


if __name__ == "__main__":
    test_chunk_text()
    test_build_run_prompt()
    test_tool_loop_events()
    print("agent-runtime run tests ok")
