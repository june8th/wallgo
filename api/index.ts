import { handleApiRequest } from '../server/router.js';

export default {
  async fetch(request: Request): Promise<Response> {
    return handleApiRequest(request);
  },
};
