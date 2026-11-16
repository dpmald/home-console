import { NextResponse, type NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

export interface DinnerTipItem {
  icon: string;
  title: string;
  detail: string;
  tag: string;
  isKidPick?: boolean;
}

export interface StructuredRecipeStep {
  stage: string;
  instruction: string;
  nextPreview: string;
  defaultTimerSecs: number;
}

export interface StructuredRecipeIngredient {
  name: string;
  amount: string;
  prep: string;
}

export interface StructuredStationNote {
  icon: string;
  title: string;
  detail: string;
}

export interface StructuredRecipePayload {
  mealTitle: string;
  prepTime: string;
  cookTime: string;
  method: string;
  servings: string;
  steps: StructuredRecipeStep[];
  ingredients: StructuredRecipeIngredient[];
  stationNotes: StructuredStationNote[];
  source: 'gemini' | 'curated';
}

export interface DinnerTipsPayload {
  mealTitle: string;
  imageUrl: string;
  imageAlt: string;
  sectionHeading: string;
  source: 'gemini' | 'curated';
  tips: DinnerTipItem[];
}

const CHARCUTERIE_IMAGE_URL =
  'https://lh3.googleusercontent.com/aida/ALJJyrDkXsWWUygnUBaIy8vBt1Yh8LX65EDDZ9IZu2XKcERGw84lZdwj0ivw4vq2e4U2JaygGhWFPT8VNzDvIKSMvA5NfFchFizGbYbhDV0aDNbXMEGSWb5X-VcJ-APPeCzaH5HuUhYqWAiVXPq-jnbgJBM7JpRmqBA5dG_O6Zb7fzhyU4rnUPgCEc-Z3fy03kq77BfuE3ckYQz9AOKxW5Zvq0fmmcCqGNgQastPsHV0Ph1Q';

const CURATED_FOOD_PHOTOS: { keywords: string[]; url: string }[] = [
  {
    keywords: ['charcuterie', 'cheese', 'grazing', 'antipasto', 'board'],
    url: CHARCUTERIE_IMAGE_URL,
  },
  {
    keywords: ['taco', 'fajita', 'burrito', 'quesadilla', 'mexican', 'enchilada', 'nachos'],
    url: 'https://images.unsplash.com/photo-1565299585323-38d6b0865b47?auto=format&fit=crop&w=1200&q=80',
  },
  {
    keywords: ['salmon', 'fish', 'seafood', 'shrimp', 'cod', 'tuna', 'poke', 'sushi'],
    url: 'https://images.unsplash.com/photo-1519708227418-c8fd9a32b7a2?auto=format&fit=crop&w=1200&q=80',
  },
  {
    keywords: ['pasta', 'orecchiette', 'spaghetti', 'lasagna', 'rigatoni', 'noodle', 'pesto', 'mac'],
    url: 'https://images.unsplash.com/photo-1621996346565-e3d5d6281298?auto=format&fit=crop&w=1200&q=80',
  },
  {
    keywords: ['pizza', 'delfina', 'flatbread', 'margherita', 'calzone'],
    url: 'https://images.unsplash.com/photo-1574071318508-1cdbab80d002?auto=format&fit=crop&w=1200&q=80',
  },
  {
    keywords: ['chicken', 'harissa', 'roast', 'wings', 'thighs', 'stir-fry', 'teriyaki'],
    url: 'https://images.unsplash.com/photo-1598515214211-89d3c73ae83b?auto=format&fit=crop&w=1200&q=80',
  },
  {
    keywords: ['salad', 'sweetgreen', 'bowl', 'grain', 'greens', 'harvest'],
    url: 'https://images.unsplash.com/photo-1512621776951-a57141f2eefd?auto=format&fit=crop&w=1200&q=80',
  },
  {
    keywords: ['thai', 'curry', 'pad see ew', 'pad thai', 'ramen', 'pho', 'soup', 'stew'],
    url: 'https://images.unsplash.com/photo-1555619452474-d2be8b1e70cd?auto=format&fit=crop&w=1200&q=80',
  },
  {
    keywords: ['burger', 'steak', 'grill', 'bbq', 'beef', 'sliders'],
    url: 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?auto=format&fit=crop&w=1200&q=80',
  },
];

const tipsCache = new Map<string, DinnerTipsPayload>();
const recipeCache = new Map<string, StructuredRecipePayload>();

function pickCuratedPhoto(mealTitle: string, searchKeyword?: string): string {
  const haystack = `${mealTitle} ${searchKeyword || ''}`.toLowerCase();
  for (const entry of CURATED_FOOD_PHOTOS) {
    if (entry.keywords.some((kw) => haystack.includes(kw))) {
      return entry.url;
    }
  }
  return CHARCUTERIE_IMAGE_URL;
}

async function lookupMealDbPhoto(query: string): Promise<string | null> {
  try {
    const clean = query.replace(/[^a-zA-Z0-9 ]/g, ' ').trim();
    if (!clean) return null;
    const res = await fetch(
      `https://www.themealdb.com/api/json/v1/1/search.php?s=${encodeURIComponent(clean)}`,
      { signal: AbortSignal.timeout(2500) },
    );
    if (!res.ok) return null;
    const data = await res.json();
    const thumb = data?.meals?.[0]?.strMealThumb;
    return typeof thumb === 'string' && thumb.startsWith('http') ? thumb : null;
  } catch {
    return null;
  }
}

function buildCuratedTipsFallback(mealTitle: string): DinnerTipsPayload {
  const lower = mealTitle.toLowerCase();
  if (lower.includes('charcuterie') || lower.includes('cheese') || lower.includes('board')) {
    return {
      mealTitle,
      imageUrl: CHARCUTERIE_IMAGE_URL,
      imageAlt: 'Artisanal Charcuterie Board',
      sectionHeading: 'Assembly Tips & Recommendations',
      source: 'curated',
      tips: [
        {
          icon: 'thermostat',
          title: 'Cheese Temperature & Slicing',
          detail: 'Let brie rest at room temp ~20m; slice sharp cheddar into wedges',
          tag: 'Cheese Tip',
        },
        {
          icon: 'layers',
          title: 'Meat Staging & Volume',
          detail: 'Fold prosciutto ribbons loosely & rosette salami for easy grabbing',
          tag: 'Meat Staging',
        },
        {
          icon: 'auto_awesome',
          title: 'Sweet & Savory Balance',
          detail: 'Center wildflower honey & mustard; pair grapes & figs near sharp cheeses',
          tag: 'Flavor Balance',
        },
        {
          icon: 'scatter_plot',
          title: 'Texture & Crunch',
          detail: 'Nestle sourdough crisps & Marcona almonds in dry pockets',
          tag: 'Crunch & Texture',
        },
        {
          icon: 'child_care',
          title: 'Kid-Friendly Staging',
          detail: 'Set mild Colby sticks & apple slices on dedicated corner for Wesley',
          tag: 'Wesley Pick',
          isKidPick: true,
        },
      ],
    };
  }

  return {
    mealTitle,
    imageUrl: pickCuratedPhoto(mealTitle),
    imageAlt: mealTitle,
    sectionHeading: 'Assembly Tips & Recommendations',
    source: 'curated',
    tips: [
      {
        icon: 'thermostat',
        title: 'Prep & Temperature Staging',
        detail: `Pull core ingredients for ${mealTitle} 15–20m ahead for even cooking & plating`,
        tag: 'Prep Tip',
      },
      {
        icon: 'layers',
        title: 'Plating & Station Flow',
        detail: 'Stage warm serving bowls and platters near the main prep counter',
        tag: 'Station Flow',
      },
      {
        icon: 'auto_awesome',
        title: 'Bright Finishing Touches',
        detail: 'Finish with a squeeze of citrus, flaky sea salt, or fresh herbs right before serving',
        tag: 'Flavor Balance',
      },
      {
        icon: 'scatter_plot',
        title: 'Side & Texture Pairing',
        detail: 'Add a crisp green salad or toasted sourdough on the side for contrast',
        tag: 'Crunch & Texture',
      },
      {
        icon: 'child_care',
        title: 'Kid-Friendly Staging',
        detail: `Portion a milder plate of ${mealTitle} with sliced fruit on the side for Wesley`,
        tag: 'Wesley Pick',
        isKidPick: true,
      },
    ],
  };
}

function buildCuratedRecipeFallback(mealTitle: string): StructuredRecipePayload {
  const lower = mealTitle.toLowerCase();

  if (lower.includes('taco')) {
    return {
      mealTitle,
      prepTime: '10 min',
      cookTime: '15 min',
      method: 'Skillet + Tortilla Warmer',
      servings: '4 Servings',
      source: 'curated',
      steps: [
        {
          stage: 'AROMATICS & SPICE',
          instruction: 'Warm olive oil in a wide skillet over medium heat; sauté diced onion, garlic, cumin, and smoked paprika for 3 minutes until fragrant.',
          nextPreview: 'Simmer seasoned black beans (5m)',
          defaultTimerSecs: 180,
        },
        {
          stage: 'BEAN SIMMER',
          instruction: 'Add 2 cans drained black beans and 1/4 cup veggie broth; mash a third of the beans with a fork and simmer 5 minutes until saucy.',
          nextPreview: 'Char corn tortillas over open flame (4m)',
          defaultTimerSecs: 300,
        },
        {
          stage: 'CRISPING TORTILLAS',
          instruction: 'Brush corn tortillas lightly with oil, fill with seasoned black beans and Monterey Jack, and pan-sear 2 minutes per side until golden and crispy.',
          nextPreview: 'Top with avocado-lime crema & cilantro (2m)',
          defaultTimerSecs: 240,
        },
        {
          stage: 'SLAWS & TOPPINGS',
          instruction: 'Toss shredded cabbage with fresh lime juice, chopped cilantro, and a pinch of flaky salt.',
          nextPreview: 'Plate tacos with lime wedges (1m)',
          defaultTimerSecs: 120,
        },
        {
          stage: 'PLATE & SERVE',
          instruction: 'Arrange crispy tacos on a warm platter with lime wedges, pickled jalapeños on the side, and mild cheese tacos for Wesley.',
          nextPreview: 'Complete & mark dinner cooked',
          defaultTimerSecs: 60,
        },
      ],
      ingredients: [
        { name: 'Seasoned Black Beans', amount: '2 × 15 oz cans', prep: 'Rinsed, drained & mashed lightly with cumin & lime' },
        { name: 'Corn Tortillas & Cheese', amount: '12 tortillas', prep: 'Monterey Jack shredded • Mild portion set aside for Wesley' },
        { name: 'Crisper Cilantro-Lime Slaw', amount: '2 cups', prep: 'Finely shredded cabbage, fresh cilantro & 2 juiced limes' },
      ],
      stationNotes: [
        { icon: 'skillet', title: '12-Inch Cast Iron Skillet', detail: 'Preheated over medium-high for crisp tortilla edges' },
        { icon: 'lunch_dining', title: 'Tortilla Warmer & Platter', detail: 'Lined with clean kitchen towel to hold heat' },
        { icon: 'child_care', title: 'Wesley Taco Station', detail: 'Mild cheese & beans without jalapeños on blue plate' },
      ],
    };
  }

  if (lower.includes('orecchiette') || lower.includes('pasta')) {
    return {
      mealTitle,
      prepTime: '10 min',
      cookTime: '15 min',
      method: 'Dutch Oven + Skillet',
      servings: '4 Servings',
      source: 'curated',
      steps: [
        {
          stage: 'BOIL PASTA WATER',
          instruction: 'Bring a large Dutch oven of generously salted water to a rolling boil and drop 1 lb orecchiette pasta.',
          nextPreview: 'Whisk lemon ricotta sauce base (4m)',
          defaultTimerSecs: 600,
        },
        {
          stage: 'RICOTTA EMULSION',
          instruction: 'Whisk 1 cup whole-milk ricotta, zest and juice of 1 lemon, 1/2 cup grated Parmesan, and olive oil in a warm serving bowl.',
          nextPreview: 'Blanch baby peas & greens in pasta water (2m)',
          defaultTimerSecs: 240,
        },
        {
          stage: 'GREENS & PASTA WATER',
          instruction: 'Scoop out 1 cup starchy pasta water, then stir baby spinach and sweet peas into the pot for the final 90 seconds of cooking.',
          nextPreview: 'Toss pasta with ricotta & pasta water (2m)',
          defaultTimerSecs: 90,
        },
        {
          stage: 'GLOSSY TOSS',
          instruction: 'Drain pasta and toss vigorously with the lemon ricotta mixture, adding warm pasta water a splash at a time until silky.',
          nextPreview: 'Garnish with basil & Pangrattato crumbs (1m)',
          defaultTimerSecs: 120,
        },
        {
          stage: 'GARNISH & SERVE',
          instruction: 'Finish with torn fresh basil, toasted garlic breadcrumbs, and extra Parmesan at the table.',
          nextPreview: 'Complete & mark dinner cooked',
          defaultTimerSecs: 60,
        },
      ],
      ingredients: [
        { name: 'Orecchiette Pasta', amount: '16 oz box', prep: 'Cooked al dente • Reserve 1 cup starchy cooking water' },
        { name: 'Fresh Whole-Milk Ricotta', amount: '1 cup + Parm', prep: 'Whisked with lemon zest, lemon juice & black pepper' },
        { name: 'Baby Spinach & Sweet Peas', amount: '4 cups', prep: 'Blanched in pasta pot during final 90 seconds' },
      ],
      stationNotes: [
        { icon: 'skillet', title: '6-Qt Dutch Oven', detail: 'Salted water at rolling boil on front burner' },
        { icon: 'countertops', title: 'Warm Ceramic Pasta Bowl', detail: 'Pre-warmed with hot water so ricotta melts smoothly' },
        { icon: 'lunch_dining', title: 'Microplane & Citrus Press', detail: 'Staged with Parmesan block and fresh lemons' },
      ],
    };
  }

  if (lower.includes('harissa') || lower.includes('chicken')) {
    return {
      mealTitle,
      prepTime: '10 min',
      cookTime: '25 min',
      method: 'Sheet-Pan Roast (425°F)',
      servings: '4 Servings',
      source: 'curated',
      steps: [
        {
          stage: 'PREHEAT & TOSS',
          instruction: 'Preheat oven to 425°F with a heavy rimmed sheet pan inside. Tosschicken thighs and sliced bell peppers with olive oil and salt.',
          nextPreview: 'Coat main portion with harissa-honey glaze (3m)',
          defaultTimerSecs: 180,
        },
        {
          stage: 'HARISSA GLAZE',
          instruction: 'Set aside 2 plain olive-oil chicken thighs for Wesley, then coat remaining chicken and peppers with 2 tbsp rose harissa and 1 tbsp honey.',
          nextPreview: 'Roast on preheated sheet pan at 425°F (22m)',
          defaultTimerSecs: 180,
        },
        {
          stage: 'SHEET-PAN ROAST',
          instruction: 'Arrange chicken and peppers in a single layer on the hot sheet pan and roast at 425°F for 22 minutes until charred at the edges.',
          nextPreview: 'Whisk cool lemon-garlic yogurt dip (3m)',
          defaultTimerSecs: 1320,
        },
        {
          stage: 'HERB YOGURT SWIRL',
          instruction: 'Stir Greek yogurt with lemon juice, a pinch of salt, and chopped mint and parsley.',
          nextPreview: 'Rest chicken & plate over yogurt swirl (3m)',
          defaultTimerSecs: 180,
        },
        {
          stage: 'PLATE & SERVE',
          instruction: 'Swoosh cool herb yogurt across warm plates, top with blistered peppers and roasted chicken, and serve with warm pita.',
          nextPreview: 'Complete & mark dinner cooked',
          defaultTimerSecs: 120,
        },
      ],
      ingredients: [
        { name: 'Boneless Chicken Thighs', amount: '1.75 lbs', prep: 'Patted dry • 2 mild pieces separated on corner for Wesley' },
        { name: 'Bell Peppers & Red Onion', amount: '3 peppers', prep: 'Sliced into 1/2-inch strips and tossed with olive oil' },
        { name: 'Harissa & Greek Yogurt Dip', amount: '1 cup yogurt', prep: '2 tbsp rose harissa + honey glaze • Cool lemon-herb yogurt' },
      ],
      stationNotes: [
        { icon: 'oven_gen', title: 'Convection Roast 425°F', detail: 'Middle rack • Half-sheet pan preheated for sear' },
        { icon: 'countertops', title: 'Foil Divider Corner', detail: 'Keeps Wesley’s mild chicken separate from harissa spice' },
        { icon: 'lunch_dining', title: 'Warm Pita Wrap', detail: 'Wrapped in foil to warm during final 5 minutes' },
      ],
    };
  }

  // Default / Crispy Miso Salmon Rice Bowls (or custom dish fallback)
  const isSalmon = lower.includes('salmon') || !mealTitle.trim();
  return {
    mealTitle: mealTitle || 'Crispy Miso Salmon Rice Bowls',
    prepTime: '20 min',
    cookTime: '18 min',
    method: 'Stovetop + Broiler',
    servings: '4 Servings',
    source: 'curated',
    steps: [
      {
        stage: 'PREP & SCORE',
        instruction: isSalmon
          ? 'Pat 4 wild salmon fillets dry with paper towels and lightly score skin at 1-inch intervals so the glaze caramelizes evenly.'
          : `Prep and portion the core ingredients for ${mealTitle} on a clean cutting board; season evenly with kosher salt.`,
        nextPreview: isSalmon ? 'Whisk sweet miso-mirin glaze (3m)' : 'Prepare sauce & aromatics (3m)',
        defaultTimerSecs: 180,
      },
      {
        stage: 'SAUCE & GLAZE',
        instruction: isSalmon
          ? 'Whisk 2 tbsp white miso, 1 tbsp mirin, 1 tsp soy sauce, and 1/2 tsp grated ginger in a small bowl until glossy and smooth.'
          : `Whisk the finishing sauce and aromatics for ${mealTitle} in a small bowl so it is ready near the stove.`,
        nextPreview: isSalmon ? 'Broil glazed salmon fillets on High (6m)' : 'Main sear / cook stage (6m)',
        defaultTimerSecs: 180,
      },
      {
        stage: 'BROILING',
        instruction: isSalmon
          ? 'Brush wild salmon fillets with sweet miso-mirin glaze and broil on High for 6 minutes until caramelized blisters form.'
          : `Cook ${mealTitle} over medium-high heat for 6 minutes until golden brown and cooked through.`,
        nextPreview: 'Plate over warm steamed jasmine rice (4m)',
        defaultTimerSecs: 342,
      },
      {
        stage: 'RICE & STAGING',
        instruction: 'Fluff warm steamed jasmine rice from the Zojirushi into 4 wide ceramic bowls and drizzle lightly with toasted sesame oil.',
        nextPreview: 'Garnish with scallions & sesame seeds (2m)',
        defaultTimerSecs: 240,
      },
      {
        stage: 'GARNISH & SERVE',
        instruction: isSalmon
          ? 'Top each bowl with a blistered miso salmon fillet, sliced scallions, and toasted white sesame seeds. Serve immediately.'
          : `Plate ${mealTitle} into warm bowls, add fresh herbs and a kid-friendly portion for Wesley, and serve warm.`,
        nextPreview: 'Complete & mark dinner cooked',
        defaultTimerSecs: 120,
      },
    ],
    ingredients: [
      {
        name: isSalmon ? 'Wild Salmon Fillets' : `${mealTitle} Main Protein/Base`,
        amount: '4 × 6 oz',
        prep: isSalmon
          ? 'Skin-on, patted dry, flesh scored lightly at 1-inch intervals'
          : 'Brought to room temp 15m ahead and seasoned evenly',
      },
      {
        name: isSalmon ? 'Sweet Miso Glaze' : 'House Sauce & Aromatics',
        amount: 'Whisked & Ready',
        prep: isSalmon
          ? '2 tbsp white miso + 1 tbsp mirin + 1 tsp soy sauce + 1/2 tsp grated ginger'
          : 'Fresh garlic, citrus, olive oil & aromatics pre-measured',
      },
      {
        name: 'Steamed Jasmine Rice',
        amount: '3 cups cooked',
        prep: 'Zojirushi keep-warm mode • Fluffed with paddle and vented',
      },
    ],
    stationNotes: [
      {
        icon: 'oven_gen',
        title: 'Broiler Rack Position',
        detail: 'Set to top position (4 inches from heat element)',
      },
      {
        icon: 'skillet',
        title: 'Cast Iron Sizzling Pan',
        detail: 'Preheated with light sesame oil',
      },
      {
        icon: 'lunch_dining',
        title: 'Garnish Station Staged',
        detail: 'Toasted white sesame seeds & sliced scallions',
      },
    ],
  };
}

export async function GET(req: NextRequest) {
  const rawMeal = req.nextUrl.searchParams.get('meal')?.trim() || 'Charcuterie Board';
  const mode = req.nextUrl.searchParams.get('mode') === 'recipe' ? 'recipe' : 'tips';
  const cacheKey = `${mode}:${rawMeal.toLowerCase()}`;

  if (mode === 'recipe') {
    const cachedRecipe = recipeCache.get(cacheKey);
    if (cachedRecipe) return NextResponse.json(cachedRecipe);

    // Exact match for the Stitch reference recipe
    if (rawMeal.toLowerCase() === 'crispy miso salmon rice bowls') {
      const curated = buildCuratedRecipeFallback(rawMeal);
      recipeCache.set(cacheKey, curated);
      return NextResponse.json(curated);
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(buildCuratedRecipeFallback(rawMeal));
    }

    try {
      const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
      const prompt = `You are a culinary assistant generating a 5-step interactive cooking display for a family of 3 (Daniela, Warren, and their kid Wesley).
The meal being cooked tonight is: "${rawMeal}".
Return a structured JSON object with:
- "prepTime": e.g. "15 min"
- "cookTime": e.g. "20 min"
- "method": e.g. "Stovetop + Broiler" or "Sheet-Pan Roast" or "One-Pot Skillet" (max 24 chars)
- "servings": "4 Servings"
- "steps": exactly 5 sequential cooking steps. Each step has:
  - "stage": 1-3 word uppercase stage name (e.g. "PREP & SCORE", "SAUCE SIMMER", "BROILING", "PLATE & SERVE")
  - "instruction": clear, bold 1-2 sentence cooking instruction (max 160 chars)
  - "nextPreview": short preview of the next step with time (e.g. "Plate over warm jasmine rice (4m)")
  - "defaultTimerSecs": integer seconds for this step's timer (between 60 and 1200)
- "ingredients": exactly 3 key ingredient groups. Each has:
  - "name": ingredient title (max 28 chars)
  - "amount": quantity badge (e.g. "4 × 6 oz", "2 cups", "Whisked & Ready")
  - "prep": 1-line preparation note (max 75 chars)
- "stationNotes": exactly 3 equipment/station setup notes. Each has:
  - "icon": one of ["oven_gen", "skillet", "lunch_dining", "countertops", "child_care"]
  - "title": equipment or station note title (max 28 chars)
  - "detail": 1-line setup note (max 65 chars; include a kid-friendly note for Wesley on the 3rd item if helpful).`;

      const geminiRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0.35,
              responseMimeType: 'application/json',
              responseSchema: {
                type: 'OBJECT',
                properties: {
                  prepTime: { type: 'STRING' },
                  cookTime: { type: 'STRING' },
                  method: { type: 'STRING' },
                  servings: { type: 'STRING' },
                  steps: {
                    type: 'ARRAY',
                    items: {
                      type: 'OBJECT',
                      properties: {
                        stage: { type: 'STRING' },
                        instruction: { type: 'STRING' },
                        nextPreview: { type: 'STRING' },
                        defaultTimerSecs: { type: 'INTEGER' },
                      },
                      required: ['stage', 'instruction', 'nextPreview', 'defaultTimerSecs'],
                    },
                  },
                  ingredients: {
                    type: 'ARRAY',
                    items: {
                      type: 'OBJECT',
                      properties: {
                        name: { type: 'STRING' },
                        amount: { type: 'STRING' },
                        prep: { type: 'STRING' },
                      },
                      required: ['name', 'amount', 'prep'],
                    },
                  },
                  stationNotes: {
                    type: 'ARRAY',
                    items: {
                      type: 'OBJECT',
                      properties: {
                        icon: { type: 'STRING' },
                        title: { type: 'STRING' },
                        detail: { type: 'STRING' },
                      },
                      required: ['icon', 'title', 'detail'],
                    },
                  },
                },
                required: ['prepTime', 'cookTime', 'method', 'servings', 'steps', 'ingredients', 'stationNotes'],
              },
            },
          }),
          signal: AbortSignal.timeout(7500),
        },
      );

      if (!geminiRes.ok) {
        return NextResponse.json(buildCuratedRecipeFallback(rawMeal));
      }

      const geminiJson = await geminiRes.json();
      const rawText = geminiJson?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!rawText) {
        return NextResponse.json(buildCuratedRecipeFallback(rawMeal));
      }

      const parsed = JSON.parse(rawText);
      const fallback = buildCuratedRecipeFallback(rawMeal);
      const payload: StructuredRecipePayload = {
        mealTitle: rawMeal,
        prepTime: parsed.prepTime || fallback.prepTime,
        cookTime: parsed.cookTime || fallback.cookTime,
        method: parsed.method || fallback.method,
        servings: parsed.servings || '4 Servings',
        steps:
          Array.isArray(parsed.steps) && parsed.steps.length > 0
            ? parsed.steps.slice(0, 5)
            : fallback.steps,
        ingredients:
          Array.isArray(parsed.ingredients) && parsed.ingredients.length > 0
            ? parsed.ingredients.slice(0, 3)
            : fallback.ingredients,
        stationNotes:
          Array.isArray(parsed.stationNotes) && parsed.stationNotes.length > 0
            ? parsed.stationNotes.slice(0, 3)
            : fallback.stationNotes,
        source: 'gemini',
      };

      recipeCache.set(cacheKey, payload);
      return NextResponse.json(payload);
    } catch {
      return NextResponse.json(buildCuratedRecipeFallback(rawMeal));
    }
  }

  // Default mode === 'tips'
  const cachedTips = tipsCache.get(cacheKey);
  if (cachedTips) {
    return NextResponse.json(cachedTips);
  }

  if (rawMeal.toLowerCase() === 'charcuterie board') {
    const fallback = buildCuratedTipsFallback(rawMeal);
    tipsCache.set(cacheKey, fallback);
    return NextResponse.json(fallback);
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(buildCuratedTipsFallback(rawMeal));
  }

  try {
    const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
    const prompt = `You are the kitchen assistant for Daniela, Warren, and their kid Wesley.
Tonight's dinner title is: "${rawMeal}".
There is no formal recipe attached, so generate 5 concise, high-impact cooking/assembly/serving tips for a 10-foot kitchen display:
- The first 4 tips should cover practical preparation, temperature/timing, flavor balance, and texture/sides for "${rawMeal}".
- Each tip must have:
  - "icon": one Material Symbols Outlined icon name from ["thermostat", "layers", "auto_awesome", "scatter_plot", "skillet", "timer", "local_fire_department", "restaurant", "grocery"]
  - "title": short 2-4 word heading (max 32 chars)
  - "detail": concise actionable 1-line guidance (max 78 chars)
  - "tag": 1-2 word badge label (max 16 chars)
- The 5th tip MUST be a kid-friendly adaptation or staging tip specifically for Wesley ("icon": "child_care", "tag": "Wesley Pick", "isKidPick": true).
- Also return "photoSearchKeyword": a simple 1-2 word dish noun (e.g. "tacos", "salmon", "pasta", "pizza", "roast chicken") to look up a representative photo.`;

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.4,
            responseMimeType: 'application/json',
            responseSchema: {
              type: 'OBJECT',
              properties: {
                sectionHeading: { type: 'STRING' },
                photoSearchKeyword: { type: 'STRING' },
                tips: {
                  type: 'ARRAY',
                  items: {
                    type: 'OBJECT',
                    properties: {
                      icon: { type: 'STRING' },
                      title: { type: 'STRING' },
                      detail: { type: 'STRING' },
                      tag: { type: 'STRING' },
                      isKidPick: { type: 'BOOLEAN' },
                    },
                    required: ['icon', 'title', 'detail', 'tag'],
                  },
                },
              },
              required: ['sectionHeading', 'photoSearchKeyword', 'tips'],
            },
          },
        }),
        signal: AbortSignal.timeout(6500),
      },
    );

    if (!geminiRes.ok) {
      return NextResponse.json(buildCuratedTipsFallback(rawMeal));
    }

    const geminiJson = await geminiRes.json();
    const rawText = geminiJson?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawText) {
      return NextResponse.json(buildCuratedTipsFallback(rawMeal));
    }

    const parsed = JSON.parse(rawText) as {
      sectionHeading?: string;
      photoSearchKeyword?: string;
      tips?: DinnerTipItem[];
    };

    const tips = Array.isArray(parsed.tips) && parsed.tips.length >= 5
      ? parsed.tips.slice(0, 5).map((t, idx) => ({
          icon: idx === 4 ? 'child_care' : t.icon || 'auto_awesome',
          title: t.title || 'Kitchen Tip',
          detail: t.detail || '',
          tag: idx === 4 ? 'Wesley Pick' : t.tag || 'Chef Tip',
          isKidPick: idx === 4 ? true : Boolean(t.isKidPick),
        }))
      : buildCuratedTipsFallback(rawMeal).tips;

    const mealDbPhoto =
      (await lookupMealDbPhoto(rawMeal)) ||
      (parsed.photoSearchKeyword ? await lookupMealDbPhoto(parsed.photoSearchKeyword) : null);
    const imageUrl = mealDbPhoto || pickCuratedPhoto(rawMeal, parsed.photoSearchKeyword);

    const payload: DinnerTipsPayload = {
      mealTitle: rawMeal,
      imageUrl,
      imageAlt: rawMeal,
      sectionHeading: parsed.sectionHeading || 'Assembly Tips & Recommendations',
      source: 'gemini',
      tips,
    };

    tipsCache.set(cacheKey, payload);
    return NextResponse.json(payload);
  } catch {
    return NextResponse.json(buildCuratedTipsFallback(rawMeal));
  }
}
