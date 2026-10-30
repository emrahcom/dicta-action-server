# Cancel without round

A cancel ends the request without another round; the halt code `cancelled` is
only in the history, never sent (`contract-protocol.md`, Added text and cancel
and Report).

- The server no longer replies with a stop to a report with the halt code
  `cancelled`: the rule goes from `pickReply`, and such a report is handled like
  any other halt.
- The test for that rule is replaced by one that shows the planner decides after
  such a report.
