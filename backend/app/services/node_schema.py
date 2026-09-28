from ..models import Workflow


def task_schema(wf: Workflow) -> dict:
    return {
        "type": "object",
        "properties": {
            "title": {"type": "string", "title": "Task", "minLength": 1, "maxLength": 200},
            "description": {"type": "string", "title": "Description", "maxLength": 5000},
            "phase": {"type": "string", "title": "Phase", "enum": wf.phases or ["General"]},
            "owner_role": {
                "type": "string",
                "title": "Owner",
                "enum": [r.name for r in wf.roles] or ["Unassigned"],
            },
            "status": {
                "type": "string",
                "title": "Status",
                "enum": ["not_started", "in_progress", "blocked", "done", "skipped"],
            },
            "priority": {"type": "string", "title": "Priority", "enum": ["low", "medium", "high"]},
            "day_offset": {"type": "integer", "title": "Starts (days after kickoff)", "minimum": 0, "maximum": 3650},
            "duration_days": {"type": "integer", "title": "Duration (days)", "minimum": 1, "maximum": 3650},
            "customer_visible": {"type": "boolean", "title": "Customer sees this"},
            "blocked_reason": {"type": "string", "title": "Why is it blocked?", "maxLength": 2000},
            "automation_hint": {"type": "string", "title": "Automation idea", "readOnly": True, "maxLength": 2000},
        },
        "required": ["title", "owner_role", "phase"],
    }


def task_uischema() -> dict:
    return {
        "type": "VerticalLayout",
        "elements": [
            {"type": "Control", "scope": "#/properties/title"},
            {"type": "Control", "scope": "#/properties/description",
             "options": {"multi": True}},
            {"type": "HorizontalLayout", "elements": [
                {"type": "Control", "scope": "#/properties/phase"},
                {"type": "Control", "scope": "#/properties/owner_role"},
            ]},
            {"type": "HorizontalLayout", "elements": [
                {"type": "Control", "scope": "#/properties/status"},
                {"type": "Control", "scope": "#/properties/priority"},
            ]},
            {"type": "HorizontalLayout", "elements": [
                {"type": "Control", "scope": "#/properties/day_offset"},
                {"type": "Control", "scope": "#/properties/duration_days"},
            ]},
            {"type": "Control", "scope": "#/properties/customer_visible"},
            {"type": "Control", "scope": "#/properties/blocked_reason",
             "rule": {"effect": "SHOW", "condition": {
                 "scope": "#/properties/status", "schema": {"const": "blocked"}}}},
            {"type": "Control", "scope": "#/properties/automation_hint"},
        ],
    }
