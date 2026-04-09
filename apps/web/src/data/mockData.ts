import type { CountrySupport, FeedPost } from "../types";

const NOW_MS = Date.now();

export const worldSupportData: CountrySupport[] = [
  { iso2: "US", country: "United States", population: 341814420, supporters: 16300000 },
  { iso2: "IN", country: "India", population: 1438069596, supporters: 24800000 },
  { iso2: "BR", country: "Brazil", population: 216422446, supporters: 13600000 },
  { iso2: "JP", country: "Japan", population: 123753041, supporters: 7600000 },
  { iso2: "KR", country: "South Korea", population: 51713126, supporters: 3300000 },
  { iso2: "NG", country: "Nigeria", population: 229152217, supporters: 5200000 },
  { iso2: "ID", country: "Indonesia", population: 281190067, supporters: 11100000 },
  { iso2: "PH", country: "Philippines", population: 115843670, supporters: 7600000 },
  { iso2: "GB", country: "United Kingdom", population: 69229552, supporters: 4200000 },
  { iso2: "DE", country: "Germany", population: 84552242, supporters: 3900000 },
  { iso2: "MX", country: "Mexico", population: 130154247, supporters: 5400000 },
  { iso2: "CA", country: "Canada", population: 40126723, supporters: 2300000 },
  { iso2: "AU", country: "Australia", population: 26713205, supporters: 1600000 }
];

export const starterPosts: FeedPost[] = [
  {
    id: "post-1",
    author: "Lina Park",
    handle: "@linapark",
    caption: "Street edits from Seoul tonight. Fast cuts and neon rain.",
    originalLanguage: "Korean",
    translatedCaptions: {
      English: "Street edits from Seoul tonight. Fast cuts and neon rain.",
      Spanish: "Ediciones callejeras desde Seúl esta noche. Cortes rápidos y lluvia neón."
    },
    countryCode: "KR",
    countryName: "South Korea",
    createdAt: "2h ago",
    createdAtHoursAgo: 2,
    createdAtMs: NOW_MS - 2 * 60 * 60 * 1000,
    posterUrl:
      "https://images.unsplash.com/photo-1470229722913-7c0e2dbbafd3?auto=format&fit=crop&w=1200&q=80",
    likes: 12400,
    comments: 640,
    reposts: 910,
    views: 285000,
    upvotes: 13120,
    neutralVotes: 3700,
    downvotes: 2100
  },
  {
    id: "post-2",
    author: "Nate Silva",
    handle: "@natesilva",
    caption: "I compared creator growth in 12 countries. Brazil is exploding per-capita.",
    originalLanguage: "English",
    translatedCaptions: {
      Portuguese: "Comparei o crescimento de criadores em 12 países. O Brasil está explodindo per capita."
    },
    countryCode: "BR",
    countryName: "Brazil",
    createdAt: "4h ago",
    createdAtHoursAgo: 4,
    createdAtMs: NOW_MS - 4 * 60 * 60 * 1000,
    posterUrl:
      "https://images.unsplash.com/photo-1515378960530-7c0da6231fb1?auto=format&fit=crop&w=1200&q=80",
    likes: 18200,
    comments: 890,
    reposts: 1460,
    views: 412000,
    upvotes: 19400,
    neutralVotes: 4700,
    downvotes: 5900
  },
  {
    id: "post-3",
    author: "Maya Chow",
    handle: "@mayachow",
    caption: "Micro-documentary: indie creators in Manila building from phones only.",
    originalLanguage: "English",
    countryCode: "PH",
    countryName: "Philippines",
    createdAt: "7h ago",
    createdAtHoursAgo: 7,
    createdAtMs: NOW_MS - 7 * 60 * 60 * 1000,
    posterUrl:
      "https://images.unsplash.com/photo-1492684223066-81342ee5ff30?auto=format&fit=crop&w=1200&q=80",
    likes: 9700,
    comments: 520,
    reposts: 730,
    views: 246000,
    upvotes: 10100,
    neutralVotes: 3100,
    downvotes: 1800
  },
  {
    id: "post-4",
    author: "Rex Coleman",
    handle: "@rexco",
    caption: "Hot take: most creators should stop editing and just publish raw footage.",
    originalLanguage: "English",
    translatedCaptions: {
      Spanish: "Opinión fuerte: la mayoría de creadores debería dejar de editar y publicar material en bruto."
    },
    countryCode: "US",
    countryName: "United States",
    createdAt: "9h ago",
    createdAtHoursAgo: 9,
    createdAtMs: NOW_MS - 9 * 60 * 60 * 1000,
    posterUrl:
      "https://images.unsplash.com/photo-1520975916090-3105956dac38?auto=format&fit=crop&w=1200&q=80",
    likes: 5300,
    comments: 4410,
    reposts: 1720,
    views: 388000,
    upvotes: 6200,
    neutralVotes: 4100,
    downvotes: 9300
  },
  {
    id: "post-5",
    author: "Ari Singh",
    handle: "@arisingh",
    caption: "This platform should hide all political clips for 30 days. Prove me wrong.",
    originalLanguage: "English",
    translatedCaptions: {
      Hindi: "इस प्लेटफ़ॉर्म को 30 दिनों के लिए सभी राजनीतिक क्लिप छुपा देने चाहिए। मुझे गलत साबित करो।"
    },
    countryCode: "IN",
    countryName: "India",
    createdAt: "11h ago",
    createdAtHoursAgo: 11,
    createdAtMs: NOW_MS - 11 * 60 * 60 * 1000,
    posterUrl:
      "https://images.unsplash.com/photo-1470225620780-dba8ba36b745?auto=format&fit=crop&w=1200&q=80",
    likes: 4100,
    comments: 5120,
    reposts: 1940,
    views: 451000,
    upvotes: 4700,
    neutralVotes: 5600,
    downvotes: 12100
  }
];
