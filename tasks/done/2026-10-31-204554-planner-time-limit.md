# Planner time limit

A planner gets at most 45 seconds for a round; one that takes longer is a
planner failure and the server sends a stop (`architecture.md`, Planner;
`contract-protocol.md`, Errors).

- `pickReply` stops waiting for the planner after 45 seconds and replies with
  the stop it sends for any planner failure.
- A reply that comes after that is dropped.
- Tests with a fake planner and a fake clock: one that answers in time, and one
  that takes longer and gets the stop.
