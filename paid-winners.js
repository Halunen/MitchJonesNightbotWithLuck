// Fictional payouts for the sandbox. This never writes payout records.
function demoPaidWinnersResponse() {
  return { demo: true, winners: [
    { username: 'CDEW', wins: 3, totalPaid: 450, currency: 'USD' },
    { username: 'AndyM', wins: 1, totalPaid: 100, currency: 'USD' },
    { username: 'GJake', wins: 2, totalPaid: 250, currency: 'USD' },
    { username: 'Thrall', wins: 1, totalPaid: 75, currency: 'USD' },
    { username: 'Jaina', wins: 2, totalPaid: 200, currency: 'USD' },
  ] };
}
function readDemoPaidWinners() {
  return demoPaidWinnersResponse().winners.map(w => ({ login: w.username.toLowerCase(), winCount: w.wins, totalPaidCents: Math.round(w.totalPaid * 100), currency: w.currency }));
}
module.exports = { demoPaidWinnersResponse, readDemoPaidWinners };
