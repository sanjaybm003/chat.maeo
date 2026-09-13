import "server-only";

export const serverEnv = {
  get supabaseServiceRoleKey() {
    const value = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
    if (!value) {
      throw new Error(
        "Missing environment variable SUPABASE_SERVICE_ROLE_KEY. It is required to send invitations and delete accounts.",
      );
    }
    return value;
  },
  get resendApiKey() {
    return process.env.RESEND_API_KEY || null;
  },
  get emailFrom() {
    return process.env.EMAIL_FROM || "maeosan <onboarding@resend.dev>";
  },
};
