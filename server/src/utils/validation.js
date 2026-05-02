const { z } = require("zod");

const registerSchema = z.object({
  email: z.string().email("Некорректный email"),
  username: z
    .string()
    .min(3, "Минимум 3 символа")
    .max(24, "Максимум 24 символа")
    .regex(/^[a-zA-Z0-9_-]+$/, "Только латиница, цифры, _ и -"),
  password: z
    .string()
    .min(8, "Минимум 8 символов")
    .max(128, "Максимум 128 символов"),
});

const loginSchema = z.object({
  login: z.string().min(1, "Введите email или имя пользователя"),
  password: z.string().min(1, "Введите пароль"),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(128),
});

const resetRequestSchema = z.object({
  email: z.string().email("Некорректный email"),
});

const resetConfirmSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8).max(128),
});

module.exports = {
  registerSchema,
  loginSchema,
  changePasswordSchema,
  resetRequestSchema,
  resetConfirmSchema,
};
