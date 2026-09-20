// Deterministic external-agent protocol fixture; not an AI integration.
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => {
  const request = JSON.parse(input);
  const response = request.task === 'review'
    ? { summary: 'External fixture review', risks: [], findings: [] }
    : { rationale: 'External fixture plan', tests: request.input.candidateTests.map(({ files, always, ...test }) => ({ ...test, reason: 'Affected behavior' })) };
  process.stdout.write(JSON.stringify(response));
});
