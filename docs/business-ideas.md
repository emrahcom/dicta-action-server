# Business ideas

dicta is open source under the Apache 2.0 license. You can build a business on
top of it. Here are some ideas.

## Host the action server for others

One server works for any number of sites. Each site sends what the server needs
in every request. So you can run one server and offer it to many sites as a
service.

- You add accounts, keys, usage limits and billing.
- You pay for the LLM calls. Your price must cover them.
- Requests, page state and step results pass through your server. Customers will
  ask where their data goes. Say clearly what you store and where.
- Hosting in a region your customers need, such as the EU, can be a selling
  point.

## Report failed requests

A failed request shows what users want but the site cannot do yet. A report of
these requests helps a site owner add the right capabilities. The server does
not store requests. You add this part.

## Build the action layer for sites

Each site needs its own capability functions and site context. Many site owners
will want help to write and test them. You can offer this as a service.

## Train a model for a platform

Many sites run on the same platform, such as WordPress or Nextcloud. Each site
has its own capability functions, but they share the same ideas: posts, pages,
files, users. A smaller model trained for one platform can plan for all these
sites. It is faster and cheaper than a large general model.

- Train it on good plans from many sites of the platform. Then it learns to
  follow each site's context, not the names of one site.
- Ask users before you use their requests to train.
- Train it again when the platform changes.
- The action server stays the same. Only the model behind the planner changes.
