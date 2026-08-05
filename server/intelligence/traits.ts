/**
 * Reviewable trait suggestions.
 *
 * Gender and culture may be proposed from name patterns (and, for gender,
 * pronouns in stored messages). They are never written without acceptance.
 * Online personality is a list of adjectives mined from the person's own
 * message text — how they show up in chat, not a clinical assessment.
 */

export type TraitSuggestion = {
  field: "gender" | "culture" | "online_personality" | "foods" | "tags";
  value: unknown;
  confidence: number;
  reason: string;
  source: string;
  /** Tokens or excerpts that justify the proposal for evidence attribution. */
  evidenceTerms: string[];
};

const FEMALE_NAMES = new Set([
  "aaliyah","abby","abigail","ada","adelaide","adeline","agnes","aisha","alexa","alexandra",
  "alice","alicia","alison","amanda","amber","amelia","amy","ana","anastasia","andrea",
  "angela","anita","anna","anne","annie","anya","april","aria","ariana","ashley","audrey",
  "aurora","ava","avery","beatrice","bella","beth","betty","beverly","bianca","brenda",
  "brianna","bridget","brittany","brooke","camila","camille","candace","carla","carly",
  "carmen","carol","caroline","carrie","cassandra","catherine","cathy","cecilia","celeste",
  "charlotte","chelsea","cheryl","chloe","christina","christine","cindy","claire","clara",
  "clarissa","claudia","colleen","constance","cora","courtney","crystal","cynthia","daisy",
  "dana","daniela","danielle","daphne","darlene","dawn","debbie","deborah","delilah","denise",
  "desiree","diana","diane","donna","doris","dorothy","eden","eileen","elaine","eleanor",
  "elena","elisa","elisabeth","elise","elizabeth","ella","ellen","ellie","eloise","elsa",
  "emily","emma","erica","erika","erin","esther","ethel","eva","eve","evelyn","faith",
  "fatima","faye","felicia","fiona","flora","florence","frances","francesca","gabriela",
  "gabrielle","gail","georgia","geraldine","gina","giulia","gladys","gloria","grace",
  "hailey","hannah","harper","hazel","heather","heidi","helen","helena","holly","hope",
  "ida","ilana","irene","iris","isabel","isabella","isabelle","iva","ivy","jackie",
  "jacqueline","jade","jamie","jane","janet","janice","jasmine","jean","jeanette","jen",
  "jennifer","jenny","jessica","jill","joan","joanna","jocelyn","jodi","josephine","joy",
  "joyce","judith","judy","julia","juliana","julie","june","katrina","kay","kayla","keira",
  "kelly","kelsey","kendall","kennedy","karen","karla","kate","katherine","kathleen",
  "kathryn","kathy","katie","katrina","kaylee","kim","kimberly","kirsten","kristen",
  "kristin","kristina","krystal","kylie","lacey","lara","laura","lauren","lea","leah",
  "lena","leona","leslie","lillian","lily","linda","lindsay","lisa","liz","liza","lois",
  "lola","lorraine","louise","lucia","lucy","luna","lynn","mabel","madison","mae","maggie",
  "mandy","mara","margaret","maria","mariah","marian","marie","marilyn","marina","marion",
  "marissa","martha","mary","maya","megan","melanie","melissa","melody","mercedes","mia",
  "michaela","michelle","mildred","mina","miranda","miriam","molly","monica","morgan",
  "myra","nadia","nancy","naomi","natalia","natalie","natasha","nicole","nina","nora",
  "norma","olga","olive","olivia","paige","pamela","patricia","patty","paula","pauline",
  "pearl","peggy","penelope","penny","phoebe","phyllis","polly","priscilla","priya","rachel",
  "rebecca","regina","renee","rhonda","rita","roberta","robin","rosa","rose","rosemary",
  "ruby","ruth","sabrina","sadie","sally","samantha","sandra","sandy","sara","sarah",
  "savannah","selena","serena","shannon","sharon","sheila","shelley","sheryl","shirley",
  "sierra","sofia","sonia","sophia","sophie","stacy","stella","stephanie","sue","susan",
  "suzanne","sydney","sylvia","tamara","tanya","tara","taylor","teresa","theresa","tiffany",
  "tina","tracy","valerie","vanessa","vera","veronica","vicki","victoria","viola","violet",
  "virginia","vivian","wanda","wendy","whitney","willow","yvonne","zoe","zoey",
  // South Asian / common in this dataset
  "aisha","ananya","anjali","asha","deepa","divya","fatima","indira","isha","kavya",
  "lakshmi","meera","nisha","pooja","priya","radha","reena","riya","sakshi","shreya",
  "simran","sneha","sonali","suhani","swati","tanvi","trisha","vidya",
]);

const MALE_NAMES = new Set([
  "aaron","adam","adrian","ahmed","alan","albert","alec","alejandro","alex","alexander",
  "alfred","ali","allen","andrew","andy","anthony","antonio","arnold","arthur","austin",
  "barry","ben","benjamin","bernard","bill","billy","blake","bob","bobby","brad","bradley",
  "brandon","brendan","brent","brett","brian","bruce","bryan","caleb","calvin","cameron",
  "carl","carlos","carter","casey","cesar","chad","charles","charlie","chase","chris",
  "christian","christopher","clarence","claude","clayton","clifford","clinton","clyde",
  "colin","connor","corey","craig","curtis","dale","damian","dan","daniel","danny","darren",
  "dave","david","dean","dennis","derek","devin","diego","dominic","don","donald","douglas",
  "drew","duncan","dustin","dylan","earl","ed","eddie","edgar","edward","edwin","eli",
  "elijah","elliot","elliott","emilio","eric","erik","ernest","ethan","eugene","evan",
  "felix","fernando","floyd","francis","francisco","frank","franklin","fred","frederick",
  "gabriel","gary","gavin","george","gerald","gilbert","glen","gordon","graham","grant",
  "greg","gregory","guy","harold","harry","harvey","hector","henry","herman","howard",
  "hugh","hunter","ian","isaac","ivan","jack","jacob","jake","james","jamie","jared",
  "jason","javier","jay","jeff","jeffrey","jeremy","jerome","jerry","jesse","jim","jimmy",
  "joe","joel","john","johnny","jon","jonathan","jordan","jorge","jose","joseph","josh",
  "joshua","juan","julian","julio","justin","karl","keith","kenneth","kevin","kyle","lance",
  "larry","lawrence","lee","leo","leon","leonard","leroy","leslie","lester","levi","lewis",
  "liam","lloyd","logan","louis","lucas","luis","luke","malcolm","manuel","marc","marco",
  "marcus","mario","mark","marshall","martin","marvin","mason","matt","matthew","maurice",
  "max","maxwell","melvin","michael","miguel","mike","miles","mitchell","morris","moses",
  "nathan","nathaniel","neal","neil","nelson","nicholas","nick","noah","norman","oliver",
  "omar","oscar","owen","pablo","patrick","paul","pedro","perry","peter","philip","phillip",
  "rafael","ralph","ramon","randall","randy","raymond","reginald","ricardo","richard","rick",
  "ricky","robert","roberto","rodney","roger","roland","ron","ronald","ronnie","ross","roy",
  "ruben","russell","ryan","salvador","sam","samuel","scott","sean","sebastian","sergio",
  "seth","shawn","sidney","simon","spencer","stanley","stephen","steve","steven","stewart",
  "stuart","ted","terry","theodore","thomas","tim","timothy","todd","tom","tommy","tony",
  "travis","trevor","troy","tyler","tyrone","victor","vincent","virgil","wade","wallace",
  "walter","warren","wayne","wesley","will","william","willie","winston","wyatt","xavier",
  "zachary","zack",
  // South Asian / common in this dataset
  "aaditya","aakash","abhay","abhinav","aditya","ajay","akash","amit","anand","anil",
  "ankit","anuj","arjun","arun","ashish","ashok","deepak","dev","dhruv","gaurav","hari",
  "harish","harsh","hemant","ishaan","karan","karthik","manish","mayank","mohan","mukesh",
  "nikhil","nitin","pranav","prashant","rahul","raj","rajan","rajesh","rakesh","ravi",
  "rohan","rohit","sachin","sandeep","sanjay","saurabh","shiv","siddharth","sriram","sunil",
  "suresh","varun","vijay","vikas","vikram","vinay","vishal","vivek","yash",
]);

/** Cultural context labels suggested from given/family name patterns. Not ethnicity claims. */
const CULTURE_BY_NAME: Record<string, string> = {
  // Given names — South Asian
  aadi: "South Asian", aaditya: "South Asian", aakash: "South Asian", abhay: "South Asian",
  abhinav: "South Asian", aditya: "South Asian", ajay: "South Asian", akash: "South Asian",
  amit: "South Asian", anand: "South Asian", ananya: "South Asian", anil: "South Asian",
  anjali: "South Asian", ankit: "South Asian", anuj: "South Asian", arjun: "South Asian",
  arun: "South Asian", asha: "South Asian", ashish: "South Asian", ashok: "South Asian",
  deepa: "South Asian", deepak: "South Asian", dev: "South Asian", dhruv: "South Asian",
  divya: "South Asian", gaurav: "South Asian", hari: "South Asian", harish: "South Asian",
  harsh: "South Asian", indira: "South Asian", ishaan: "South Asian", isha: "South Asian",
  karan: "South Asian", karthik: "South Asian", kavya: "South Asian", lakshmi: "South Asian",
  manish: "South Asian", mayank: "South Asian", meera: "South Asian", mohan: "South Asian",
  mukesh: "South Asian", nikhil: "South Asian", nisha: "South Asian", nitin: "South Asian",
  pooja: "South Asian", pranav: "South Asian", prashant: "South Asian", priya: "South Asian",
  radha: "South Asian", rahul: "South Asian", raj: "South Asian", rajan: "South Asian",
  rajesh: "South Asian", rakesh: "South Asian", ravi: "South Asian", reena: "South Asian",
  riya: "South Asian", rohan: "South Asian", rohit: "South Asian", sachin: "South Asian",
  sakshi: "South Asian", sandeep: "South Asian", sanjay: "South Asian", saurabh: "South Asian",
  shiv: "South Asian", shreya: "South Asian", siddharth: "South Asian", simran: "South Asian",
  sneha: "South Asian", sonali: "South Asian", sriram: "South Asian", suhani: "South Asian",
  sunil: "South Asian", suresh: "South Asian", swati: "South Asian", tanvi: "South Asian",
  trisha: "South Asian", varun: "South Asian", vidya: "South Asian", vijay: "South Asian",
  vikas: "South Asian", vikram: "South Asian", vinay: "South Asian", vishal: "South Asian",
  vivek: "South Asian", yash: "South Asian",
  // East Asian given
  wei: "East Asian", ming: "East Asian", jing: "East Asian", yuki: "East Asian",
  hiroshi: "East Asian", kenji: "East Asian", sakura: "East Asian", mei: "East Asian",
  // Hispanic / Latino given
  jose: "Hispanic / Latino", juan: "Hispanic / Latino", carlos: "Hispanic / Latino",
  maria: "Hispanic / Latino", diego: "Hispanic / Latino", lucia: "Hispanic / Latino",
  sofia: "Hispanic / Latino", miguel: "Hispanic / Latino", gabriel: "Hispanic / Latino",
  // Arabic / Middle Eastern given
  ahmed: "Arabic / Middle Eastern", ali: "Arabic / Middle Eastern", omar: "Arabic / Middle Eastern",
  fatima: "Arabic / Middle Eastern", aisha: "Arabic / Middle Eastern", yusuf: "Arabic / Middle Eastern",
  // Hebrew / Jewish given
  noa: "Jewish / Hebrew", yael: "Jewish / Hebrew", avi: "Jewish / Hebrew",
  moshe: "Jewish / Hebrew", rivka: "Jewish / Hebrew",
};

const CULTURE_BY_SURNAME_SUFFIX: Array<{ suffix: string; culture: string }> = [
  { suffix: "opoulos", culture: "Greek" },
  { suffix: "owicz", culture: "Polish / Slavic" },
  { suffix: "ewski", culture: "Polish / Slavic" },
  { suffix: "ski", culture: "Polish / Slavic" },
  { suffix: "sson", culture: "Nordic" },
  { suffix: "sen", culture: "Nordic" },
  { suffix: "ova", culture: "Slavic" },
  { suffix: "eva", culture: "Slavic" },
  { suffix: "ovic", culture: "South Slavic" },
  { suffix: "ić", culture: "South Slavic" },
  { suffix: "escu", culture: "Romanian" },
  { suffix: "ez", culture: "Hispanic / Latino" },
  { suffix: "az", culture: "Hispanic / Latino" },
  { suffix: "ian", culture: "Armenian" },
  { suffix: "yan", culture: "Armenian" },
];

const CULTURE_BY_SURNAME: Record<string, string> = {
  mysore: "South Asian", khan: "South Asian / Central Asian", singh: "South Asian",
  sharma: "South Asian", patel: "South Asian", gupta: "South Asian", reddy: "South Asian",
  iyer: "South Asian", nair: "South Asian", mehta: "South Asian", joshi: "South Asian",
  chopra: "South Asian", kapoor: "South Asian", malhotra: "South Asian", agrawal: "South Asian",
  agarwal: "South Asian", banerjee: "South Asian", chatterjee: "South Asian", mukherjee: "South Asian",
  das: "South Asian", rao: "South Asian", naik: "South Asian", shetty: "South Asian",
  khanna: "South Asian", bhat: "South Asian", pillai: "South Asian", menon: "South Asian",
  kim: "East Asian", park: "East Asian", choi: "East Asian", lee: "East Asian",
  wang: "East Asian", chen: "East Asian", zhang: "East Asian", liu: "East Asian",
  yang: "East Asian", huang: "East Asian", wu: "East Asian", tanaka: "East Asian",
  suzuki: "East Asian", watanabe: "East Asian", yamamoto: "East Asian",
  nguyen: "Vietnamese", tran: "Vietnamese", pham: "Vietnamese", le: "Vietnamese",
  garcia: "Hispanic / Latino", rodriguez: "Hispanic / Latino", martinez: "Hispanic / Latino",
  hernandez: "Hispanic / Latino", lopez: "Hispanic / Latino", gonzalez: "Hispanic / Latino",
  perez: "Hispanic / Latino", sanchez: "Hispanic / Latino", ramirez: "Hispanic / Latino",
  torres: "Hispanic / Latino", flores: "Hispanic / Latino", rivera: "Hispanic / Latino",
  okonkwo: "West African", adebayo: "West African", okafor: "West African",
  mwangi: "East African", kamau: "East African",
};

/** Communication-style adjectives mined from message text. */
const ONLINE_ADJECTIVES: Array<{ word: string; label: string }> = [
  { word: "haha", label: "playful" },
  { word: "lol", label: "playful" },
  { word: "lmao", label: "playful" },
  { word: "😂", label: "playful" },
  { word: "😄", label: "playful" },
  { word: "thanks", label: "courteous" },
  { word: "thank you", label: "courteous" },
  { word: "appreciate", label: "courteous" },
  { word: "please", label: "courteous" },
  { word: "sorry", label: "apologetic" },
  { word: "asap", label: "direct" },
  { word: "quick question", label: "direct" },
  { word: "btw", label: "casual" },
  { word: "gonna", label: "casual" },
  { word: "wanna", label: "casual" },
  { word: "yeah", label: "casual" },
  { word: "yep", label: "casual" },
  { word: "sure thing", label: "agreeable" },
  { word: "absolutely", label: "enthusiastic" },
  { word: "excited", label: "enthusiastic" },
  { word: "love this", label: "enthusiastic" },
  { word: "amazing", label: "enthusiastic" },
  { word: "curious", label: "inquisitive" },
  { word: "wondering", label: "inquisitive" },
  { word: "thoughts?", label: "collaborative" },
  { word: "what do you think", label: "collaborative" },
  { word: "let me know", label: "collaborative" },
  { word: "circle back", label: "professional" },
  { word: "per my", label: "professional" },
  { word: "following up", label: "persistent" },
  { word: "checking in", label: "persistent" },
  { word: "congrats", label: "supportive" },
  { word: "proud of", label: "supportive" },
  { word: "here if you need", label: "supportive" },
  { word: "miss you", label: "affectionate" },
  { word: "love you", label: "affectionate" },
  { word: "❤️", label: "affectionate" },
  { word: "🙏", label: "grateful" },
  { word: "fyi", label: "informative" },
  { word: "sharing", label: "informative" },
  { word: "update:", label: "informative" },
  { word: "!!!", label: "expressive" },
  { word: "…", label: "understated" },
  { word: "...", label: "understated" },
];

const FOOD_TERMS = [
  "pizza", "sushi", "ramen", "pasta", "taco", "biryani", "curry", "dosa", "idli",
  "coffee", "tea", "matcha", "wine", "beer", "whiskey", "cocktail", "vegan",
  "vegetarian", "gluten", "chocolate", "ice cream", "burger", "steak", "seafood",
  "dim sum", "pho", "kimchi", "falafel", "hummus", "bagel", "croissant", "brunch",
];

function nameParts(person: { preferred_name?: string; first_name?: string; last_name?: string; name?: string }) {
  const full = String(person.preferred_name || person.name || "").trim();
  const first = String(person.first_name || full.split(/\s+/)[0] || "").trim().toLowerCase();
  const last = String(person.last_name || full.split(/\s+/).slice(-1)[0] || "").trim().toLowerCase();
  return { first, last, full };
}

function empty(value: unknown) {
  if (value === null || value === undefined) return true;
  if (Array.isArray(value)) return value.length === 0;
  return String(value).trim() === "";
}

function pronounceGender(texts: string[]): { value: string; confidence: number; term: string } | null {
  let she = 0;
  let he = 0;
  for (const text of texts) {
    const lower = text.toLowerCase();
    she += (lower.match(/\b(she|her|hers)\b/g) || []).length;
    he += (lower.match(/\b(he|him|his)\b/g) || []).length;
  }
  if (she >= 3 && she > he * 2) return { value: "female", confidence: Math.min(0.86, 0.62 + she * 0.02), term: "she/her" };
  if (he >= 3 && he > she * 2) return { value: "male", confidence: Math.min(0.86, 0.62 + he * 0.02), term: "he/him" };
  return null;
}

export function suggestGenderFromName(
  person: { preferred_name?: string; first_name?: string; name?: string; gender?: string },
  messageBodies: string[] = [],
): TraitSuggestion | null {
  if (!empty(person.gender)) return null;
  const pronoun = pronounceGender(messageBodies);
  if (pronoun) {
    return {
      field: "gender",
      value: pronoun.value,
      confidence: pronoun.confidence,
      reason: `Pronouns in stored messages lean ${pronoun.term}. Review before accepting.`,
      source: "Message pronouns",
      evidenceTerms: [pronoun.term],
    };
  }
  const { first } = nameParts(person);
  if (!first || first.length < 2) return null;
  if (FEMALE_NAMES.has(first)) {
    return {
      field: "gender",
      value: "female",
      confidence: 0.68,
      reason: `Given name “${first}” commonly maps to female in name tables. Accept only if correct.`,
      source: "Name inference",
      evidenceTerms: [first],
    };
  }
  if (MALE_NAMES.has(first)) {
    return {
      field: "gender",
      value: "male",
      confidence: 0.68,
      reason: `Given name “${first}” commonly maps to male in name tables. Accept only if correct.`,
      source: "Name inference",
      evidenceTerms: [first],
    };
  }
  return null;
}

export function suggestCultureFromName(
  person: { preferred_name?: string; first_name?: string; last_name?: string; name?: string; culture?: string },
): TraitSuggestion | null {
  if (!empty(person.culture)) return null;
  const { first, last } = nameParts(person);
  if (first && CULTURE_BY_NAME[first]) {
    return {
      field: "culture",
      value: CULTURE_BY_NAME[first],
      confidence: 0.58,
      reason: `Suggested cultural context from given name “${first}”. This is not ethnicity — accept only if it fits.`,
      source: "Name inference",
      evidenceTerms: [first],
    };
  }
  if (last && CULTURE_BY_SURNAME[last]) {
    return {
      field: "culture",
      value: CULTURE_BY_SURNAME[last],
      confidence: 0.6,
      reason: `Suggested cultural context from family name “${last}”. This is not ethnicity — accept only if it fits.`,
      source: "Name inference",
      evidenceTerms: [last],
    };
  }
  if (last) {
    // Require a real multi-syllable family name — short given-name-only
    // contacts like “Aaryan” must not match the Armenian “-yan” suffix.
    const suffix = CULTURE_BY_SURNAME_SUFFIX.find(
      (entry) => last.endsWith(entry.suffix) && last.length > entry.suffix.length + 2,
    );
    if (suffix) {
      return {
        field: "culture",
        value: suffix.culture,
        confidence: 0.55,
        reason: `Suggested cultural context from family-name ending “${suffix.suffix}”. Review carefully.`,
        source: "Name inference",
        evidenceTerms: [last],
      };
    }
  }
  return null;
}

export function suggestOnlinePersonality(
  person: { online_personality?: string[] | string | null },
  messageBodies: string[],
): TraitSuggestion | null {
  if (!empty(person.online_personality)) return null;
  if (messageBodies.length < 3) return null;

  const scores = new Map<string, { count: number; samples: string[] }>();
  for (const body of messageBodies) {
    const lower = body.toLowerCase();
    for (const { word, label } of ONLINE_ADJECTIVES) {
      if (!lower.includes(word)) continue;
      const entry = scores.get(label) ?? { count: 0, samples: [] };
      entry.count += 1;
      if (entry.samples.length < 2) {
        const excerpt = body.replace(/\s+/g, " ").trim().slice(0, 120);
        if (excerpt) entry.samples.push(excerpt);
      }
      scores.set(label, entry);
    }
  }

  const ranked = [...scores.entries()]
    .filter(([, meta]) => meta.count >= 2)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 8);
  if (ranked.length < 2) return null;

  const adjectives = ranked.map(([label]) => label);
  const samples = ranked.flatMap(([, meta]) => meta.samples).slice(0, 4);
  return {
    field: "online_personality",
    value: adjectives,
    confidence: Math.min(0.84, 0.55 + ranked.length * 0.04),
    reason: `Adjectives from how they write in ${messageBodies.length} stored messages.`,
    source: "Message style",
    evidenceTerms: samples.length ? samples : adjectives,
  };
}

export function suggestFoodsFromMessages(
  person: { foods?: string[] | string | null },
  messageBodies: string[],
): TraitSuggestion | null {
  if (!empty(person.foods)) return null;
  const found = new Map<string, string>();
  for (const body of messageBodies) {
    const lower = body.toLowerCase();
    for (const term of FOOD_TERMS) {
      if (lower.includes(term) && !found.has(term)) {
        found.set(term, body.replace(/\s+/g, " ").trim().slice(0, 120));
      }
    }
  }
  if (!found.size) return null;
  const values = [...found.keys()].slice(0, 10);
  return {
    field: "foods",
    value: values,
    confidence: Math.min(0.8, 0.55 + values.length * 0.03),
    reason: "Foods and drinks mentioned in stored messages.",
    source: "Message topics",
    evidenceTerms: [...found.values()].slice(0, 4),
  };
}

const CATEGORY_WORDS = [
  "finance", "policy", "fundraising", "AI", "robotics", "health", "travel",
  "founder", "investor", "climate", "design", "product", "research",
];

export function suggestTagsFromMessages(
  person: { tags?: string[] },
  messageBodies: string[],
): TraitSuggestion | null {
  const existing = new Set((person.tags || []).map((tag) => tag.toLowerCase()));
  const found = new Map<string, string>();
  for (const body of messageBodies) {
    for (const tag of CATEGORY_WORDS) {
      if (existing.has(tag.toLowerCase()) || found.has(tag)) continue;
      if (new RegExp(`\\b${tag}\\b`, "i").test(body)) {
        found.set(tag, body.replace(/\s+/g, " ").trim().slice(0, 120));
      }
    }
  }
  if (!found.size) return null;
  const values = [...found.keys()].slice(0, 8);
  return {
    field: "tags",
    value: values,
    confidence: Math.min(0.75, 0.5 + values.length * 0.03),
    reason: "Categories mentioned in stored messages.",
    source: "Message topics",
    evidenceTerms: [...found.values()].slice(0, 4),
  };
}

export function collectTraitSuggestions(
  person: Record<string, unknown>,
  messageBodies: string[],
): TraitSuggestion[] {
  return [
    suggestGenderFromName(person as never, messageBodies),
    suggestCultureFromName(person as never),
    suggestOnlinePersonality(person as never, messageBodies),
    suggestFoodsFromMessages(person as never, messageBodies),
    suggestTagsFromMessages(person as never, messageBodies),
  ].filter((item): item is TraitSuggestion => Boolean(item));
}
