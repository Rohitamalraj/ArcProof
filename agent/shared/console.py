"""Consistent, color-coded terminal logging shared by every agent process.

Each agent gets a tag and a color so when all five services are running at
once (each in its own process, printing to the same terminal via the CLI
runner) you can visually tell who's talking. This is deliberately simple
text logging, not structured logging -- the point of this project's
terminal view is human legibility during a live demo.
"""
from __future__ import annotations
from rich.console import Console

_console = Console()

AGENT_COLORS = {
    "orchestrator": "bold cyan",
    "onchain-agent-v1": "bold green",
    "news-agent-v1": "bold yellow",
    "compliance-agent-v1": "bold magenta",
    "evaluator": "bold red",
    "settlement": "bold blue",
    "x402": "grey62",
    "wallet": "grey62",
    "cli": "bold white",
}


def log(agent: str, message: str, style: str | None = None) -> None:
    color = style or AGENT_COLORS.get(agent, "white")
    _console.print(f"[{color}]" + "\\[" + f"{agent}][/{color}] {message}")


def rule(title: str, style: str = "bold cyan") -> None:
    _console.rule(f"[{style}]{title}[/{style}]")


def get_console() -> Console:
    return _console
