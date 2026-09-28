from datetime import date, timedelta

from .models import Milestone, Task, Workflow, XY


def sample_workflow() -> Workflow:
    return Workflow(
        id="sample-northstar",
        customer_name="Northstar Studio",
        brief="A fictional 12-person creative agency moving customer handoffs into a shared onboarding workflow. Goal: launch one repeatable client onboarding process in two weeks, with a clear owner and no missed approvals.",
        start_date=date.today() - timedelta(days=3),
        is_sample_data=True,
        tasks=[
            Task(id="kickoff", title="Align on the first win", description="Meet the customer champion. Agree on the first workflow to launch and define a measurable success criterion: every client handoff has an owner.", phase="Discover", owner_role="Customer Success", status="done", priority="high", duration_days=1, automation_hint="Summarize kickoff notes into a draft workflow for human review."),
            Task(id="map-process", title="Map the customer handoff", description="Capture the current handoff, approval points, and information that is usually missing.", phase="Discover", owner_role="Customer", status="done", day_offset=1, duration_days=2, depends_on=["kickoff"]),
            Task(id="build-workflow", title="Shape the onboarding flow", description="Turn the approved process into tasks, owners, due dates, and dependencies. Confirm the customer-facing steps.", phase="Configure", owner_role="Customer Success", status="in_progress", priority="high", day_offset=3, duration_days=2, depends_on=["map-process"], automation_hint="Suggest missing tasks and dependency links; let the CSM approve the plan."),
            Task(id="workspace-access", title="Confirm workspace access", description="Ask the customer champion to confirm the teammate list and grant access for the pilot.", phase="Configure", owner_role="Customer", status="blocked", priority="high", day_offset=2, duration_days=1, depends_on=["map-process"], blocked_reason="Waiting for the customer champion to confirm the teammate list.", automation_hint="Draft a concise follow-up with the blocker and a clear next action."),
            Task(id="pilot", title="Run one real handoff", description="Walk a pilot customer through the process together. Record points of friction and resolve them before rollout.", phase="Configure", owner_role="Solutions Engineer", day_offset=5, duration_days=2, depends_on=["build-workflow", "workspace-access"]),
            Task(id="launch", title="Give the team the keys", description="Train the owners, confirm escalation contacts, and publish the approved workflow.", phase="Launch", owner_role="Customer Success", day_offset=7, duration_days=1, depends_on=["pilot"]),
            Task(id="first-value", title="Celebrate the first win", description="Review the first completed handoff against the kickoff goal. Agree on the next improvement with the customer.", phase="Launch", owner_role="Customer Success", day_offset=10, duration_days=1, depends_on=["launch"]),
        ],
        milestones=[Milestone(id="first-value", title="First client handoff complete", task_ids=["first-value"])],
        node_positions={
            "kickoff": XY(x=0, y=130), "map-process": XY(x=350, y=130),
            "build-workflow": XY(x=700, y=0), "workspace-access": XY(x=700, y=280),
            "pilot": XY(x=1050, y=130), "launch": XY(x=1400, y=130),
            "first-value": XY(x=1750, y=130),
        },
    )
