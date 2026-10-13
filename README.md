# TDS CRM Production Setup

The CRM uses a Vercel-hosted Vite frontend, a Render-hosted Express API, MongoDB Atlas, and Resend. The browser only communicates with the same-origin Vercel `/api/*` proxy; staff and customer portal sessions use HttpOnly cookies.

## Deploy the backend to Render

1. Create a Render web service from this repository using the included `render.yaml`.
2. Set `MONGODB_URI` to the Atlas connection string, `CLIENT_ORIGIN` to the exact Vercel frontend origin, `STAFF_ADMIN_KEY` to a unique random secret of at least 32 characters, all four R2 values, and the three Resend values in the Render environment settings.
3. Configure MongoDB Atlas network access to allow the Render service to reach the cluster.
4. Wait for the `/api/health` check to report `status: ok`, `database: connected`, and `documents: configured`.

Create a **private** Cloudflare R2 bucket and an R2 API token scoped to that bucket with object read/write permissions. Set its account ID, access key ID, secret access key, and bucket name as the four `R2_*` environment variables. Configure the bucket CORS policy to allow `PUT`, `GET`, and `HEAD` from the Vercel frontend origin (and the local Vite origin during development), with the `Content-Type` request header. Add an R2 lifecycle rule to delete objects under the `pending/` prefix after one day.

Staff password reset emails use the same verified Resend sender as staff invitations. Reset links expire after one hour, are single-use, and revoke all active sessions for the account when redeemed.

New staff members complete their name, title, department, and phone profile on first sign-in. Administrators manage page access for real staff login accounts under **Admin Settings → Users & Roles**; administrators always retain full access, while new non-admin accounts begin with Dashboard access only.

The Render service binds to the platform-provided `PORT`. Do not put any secret in a `VITE_` variable or commit it to the repository.

## Deploy the frontend to Vercel

1. Import the repository into Vercel and set the project root to `Frontend`.
2. Use the Vite build with output directory `dist`.
3. Set the server-side environment variable `BACKEND_URL` to the Render service origin, without an `/api` suffix. This is used only by `Frontend/api/[...path].js`; it is not exposed to the browser bundle.
4. Configure the Vercel deployment's canonical origin as Render's `CLIENT_ORIGIN`, then redeploy both services if needed.

## Create the first staff administrator

Open the deployed CRM and choose **Set up or invite a staff account**. Enter the Render `STAFF_ADMIN_KEY` to send the first administrator invitation. After activation, only signed-in administrators can invite additional staff. Staff passwords must be at least 12 characters.

On the first sign-in from each browser, existing browser-local CRM records are merged into shared MongoDB storage by record ID, and document binaries in IndexedDB are copied to R2. The original local snapshots are preserved. Subsequent CRM changes sync to the backend; sync failures are shown in the CRM header. Document downloads use short-lived signed R2 URLs, and customer downloads are authorized against the customer's account before a URL is issued.

## Development

- `pnpm dev:frontend` — run Vite on port 8443.
- `pnpm dev:backend` — run the API on port 3001.
- `pnpm typecheck` — typecheck both packages.
- `pnpm verify` — typecheck, build, and run the API smoke tests.
- `pnpm --dir Backend build` — compile the production API to `Backend/dist`.
- `pnpm --dir Backend start` — start the compiled production API.

Set `NGROK_HOST` only when a development tunnel requires an extra Vite allowed host. Set `API_URL` for the local Vite `/api` proxy if the backend is not on localhost.

## API and webhooks

- `GET /api/health`
- Staff session: `/api/staff-auth/*`
- Staff CRM API resources: `/api/customers`, `/api/leads`, `/api/activities`, `/api/opportunities`, `/api/proposals`, `/api/invoices`, `/api/contracts`, `/api/projects`, `/api/documents`, and `/api/organizations`
- Staff data migration/profile: `/api/staff-data/*`
- Customer portal: `/customer-portal` and `/api/customer-portal/*`
- Resend webhook: `/api/webhooks/resend`

Register the deployed `/api/webhooks/resend` URL in Resend and subscribe to the sent, delivered, delayed, bounced, complained, and failed events.
