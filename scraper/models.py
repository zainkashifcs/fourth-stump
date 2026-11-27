"""The part of a Cricsheet match file (JSON format 1.x) that the per-ball table uses.

Everything else in a match file is ignored. Format: https://cricsheet.org/format/json/
"""
from datetime import date

from pydantic import BaseModel, Field


class Runs(BaseModel):
    batter: int = Field(ge=0)
    extras: int = Field(ge=0)
    total: int = Field(ge=0)


class Fielder(BaseModel):
    name: str | None = None  # an unnamed substitute carries no name


class Wicket(BaseModel):
    kind: str
    fielders: list[Fielder] = []


class Delivery(BaseModel):
    runs: Runs
    extras: dict[str, int] = {}
    wickets: list[Wicket] = []


class Over(BaseModel):
    over: int = Field(ge=0)  # 0-based in the file
    deliveries: list[Delivery]


class Innings(BaseModel):
    team: str
    overs: list[Over] = []  # absent for a forfeited innings


class Info(BaseModel):
    dates: list[date] = Field(min_length=1)
    venue: str
    gender: str
    match_type: str


class Match(BaseModel):
    info: Info
    innings: list[Innings] = []
