import type {Config} from '@netlify/functions';
import { createAdminHandler } from './_shared/admin-handler';
export default createAdminHandler();
export const config:Config={path:'/api/admin',rateLimit:{action:'rate_limit',aggregateBy:['domain','ip'],windowSize:60,windowLimit:90}};
