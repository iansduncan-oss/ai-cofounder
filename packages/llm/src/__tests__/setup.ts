// LLM registry tests register many providers, each adding process exit handlers
// that accumulate and exceed the default limit of 10.
process.setMaxListeners(0);
