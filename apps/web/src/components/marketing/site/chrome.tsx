/**
 * COMPAT SHIM. The marketing site no longer uses this file (see
 * components/marketing/site-header.tsx and site-footer.tsx). It only keeps
 * `Logo` alive for components/auth/auth-frame.tsx until the auth rebrand
 * moves that frame onto <BrandLogo/>. Delete this file (and satin.tsx)
 * once nothing imports them.
 */
export { SiteLogo as Logo } from '../site-logo';
