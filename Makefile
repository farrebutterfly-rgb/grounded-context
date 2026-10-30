.PHONY: install demo test typecheck eval live check
Q ?= What is the monthly fee for office cleaning?
install:   ## pinned dependencies from package-lock.json
	npm ci
demo:      ## fixture demo, no API key, no cost; writes evidence/
	npm run demo
test:      ## unit, pipeline, context and CLI tests
	npm test
typecheck:
	npm run typecheck
eval:      ## labelled questions + context comparison; BUDGET=800 make eval
	npm run eval -- --budget $${BUDGET:-500}
live:      ## real model run, needs ANTHROPIC_API_KEY, costs money
	npm run live -- "$(Q)"
check: typecheck test demo
