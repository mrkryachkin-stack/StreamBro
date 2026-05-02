const PLANS = {
  FREE: {
    id: "FREE",
    name: "Бесплатный",
    price: 0,
    currency: "RUB",
    interval: null,
    features: [
      "Стриминг на 1 платформу",
      "Запись в MP4",
      "720p 30fps",
      "Базовый микшер",
      "P2P со-стрим",
    ],
    limits: {
      maxPlatforms: 1,
      maxResolution: "720p",
      maxFps: 30,
      maxBitrate: 3000,
    },
  },
  PRO: {
    id: "PRO",
    name: "Pro",
    price: 299,
    currency: "RUB",
    interval: "month",
    yookassaId: null, // filled after YooKassa product creation
    features: [
      "Стриминг на 3 платформы",
      "Запись в MP4",
      "1080p 60fps",
      "Продвинутый микшер с FX",
      "P2P со-стрим",
      "Приоритетная поддержка",
    ],
    limits: {
      maxPlatforms: 3,
      maxResolution: "1080p",
      maxFps: 60,
      maxBitrate: 8000,
    },
  },
  ULTIMATE: {
    id: "ULTIMATE",
    name: "Ultimate",
    price: 599,
    currency: "RUB",
    interval: "month",
    yookassaId: null,
    features: [
      "Стриминг на все платформы",
      "Запись в MP4",
      "4K 60fps",
      "Продвинутый микшер с FX",
      "P2P со-стрим",
      "Приоритетная поддержка",
      "Ранний доступ к новым функциям",
    ],
    limits: {
      maxPlatforms: 999,
      maxResolution: "4K",
      maxFps: 60,
      maxBitrate: 20000,
    },
  },
};

module.exports = PLANS;
