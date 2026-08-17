// Thin wrapper over the JSON API.

async function request(path, options = {}) {
  const res = await fetch(path, {
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
    ...options,
  });
  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = await res.json();
      if (body && body.error) message = body.error;
    } catch {
      // Non-JSON error body; the status text will do.
    }
    throw new Error(message);
  }
  if (res.status === 204) return null;
  return res.json();
}

export const api = {
  catalog: () => request('/api/catalog'),
  listCampaigns: () => request('/api/campaigns'),
  createCampaign: (name) =>
    request('/api/campaigns', { method: 'POST', body: JSON.stringify({ name }) }),
  getCampaign: (id) => request(`/api/campaigns/${encodeURIComponent(id)}`),
  saveCampaign: (id, campaign) =>
    request(`/api/campaigns/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(campaign),
    }),
  deleteCampaign: (id) =>
    request(`/api/campaigns/${encodeURIComponent(id)}`, { method: 'DELETE' }),
};
