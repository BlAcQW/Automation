/**
 * The trip as the flow holds it in its variables. Written by the engine's
 * location step (pickup_*) and by the quote actions (trip_dest_*), read by the
 * request action and the PAYG payment preparer. Flow variables are strings;
 * coordinates are parsed and range-checked here, never trusted as-is.
 */
import { isValidCoordinate } from './geo.js';
import type { Place } from './rides.js';

export interface TripVars {
    pickup: Place;
    destination: Place;
}

function place(vars: Record<string, string>, prefix: string, labelKey: string, idKey?: string): Place | null {
    const lat = Number(vars[`${prefix}_lat`]);
    const lng = Number(vars[`${prefix}_lng`]);
    if (vars[`${prefix}_lat`] === undefined || vars[`${prefix}_lat`] === '' || !isValidCoordinate(lat, lng)) return null;
    return { label: vars[labelKey] || 'Shared location', lat, lng, id: idKey && vars[idKey] ? vars[idKey] : null };
}

export function pickupFromVars(vars: Record<string, string>): Place | null {
    return place(vars, 'pickup', 'pickup_label');
}

export function tripFromVars(vars: Record<string, string>): TripVars | null {
    const pickup = pickupFromVars(vars);
    const destination = place(vars, 'trip_dest', 'trip_dest', 'trip_dest_id');
    return pickup && destination ? { pickup, destination } : null;
}
