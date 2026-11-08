/** Paste into an Auth0 Post-Login Action and attach it to the Login flow.
 * Create a role named exactly `nurse` and assign it only to approved nurses.
 * Auth0 must expose the role to the action as event.authorization.roles.
 */
exports.onExecutePostLogin = async (event, api) => {
  // Limit this Action to WaitWatch; do not deny users of unrelated Auth0 apps.
  if (event.client.client_id !== "FiuY9t6YwrgWGTSbp2j10X8dfaUoIMfn") return;
  const roles = event.authorization?.roles || [];
  if (!roles.some((role) => String(role).toLowerCase() === "nurse")) {
    api.access.deny("This application is limited to approved nursing staff.");
    return;
  }
  const claim = "https://waitwatch/api/roles";
  api.idToken.setCustomClaim(claim, roles);
  api.accessToken.setCustomClaim(claim, roles);
};
