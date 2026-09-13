import "server-only";

// `||`, not `??`: an empty variable in .env.local means "not set".
const serviceRoleKey = () => process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;

export const serverEnv = {
  get supabaseServiceRoleKey() {
    const value = serviceRoleKey();
    if (!value) {
      throw new Error(
        "Missing environment variable SUPABASE_SERVICE_ROLE_KEY. It is required to send invitations and delete accounts.",
      );
    }
    return value;
  },
  get hasServiceRoleKey() {
    return Boolean(serviceRoleKey());
  },
  get resendApiKey() {
    return process.env.RESEND_API_KEY || null;
  },
  get emailFrom() {
    return process.env.EMAIL_FROM || "maeosan <onboarding@resend.dev>";
  },
};
