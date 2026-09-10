"use strict";

// ---------------------------------------------------------------- state

const $ = (id) => document.getElementById(id);

let tree = null;          // /api/tree result
let file = null;          // /api/file result (model, mutated in place)
let dirty = false;
let viewMode = "raw";     // "player" | "raw" (player only for playerdata files)
let activeRow = null;     // sidebar DOM row of the open file
let currentServer = null; // server object when the server overview is shown
const expanded = new Set(["$"]);   // editor node paths expanded
const sbOpen = new Set();          // sidebar group keys expanded

// player-view inventory browser state (modals hold their own)
const invState = { rootKey: null, stack: [], query: "" };

// global tag-path search
let tagMatches = [];
let tagSel = -1;

let effectIdsLoaded = null;        // server whose effect datalist is loaded
let effectIds = [];                // known effect ids for the current server
let itemIdsLoaded = null;          // server whose item id list is loaded
let itemIds = [];                  // known item/block ids for the current server

// Potion duration is a signed 32-bit int of ticks; the game can't hold more.
const DURATION_MAX = 2147483647;

const CONTAINERS = new Set(["compound", "list", "byteArray", "intArray", "longArray"]);
const NUMS = { byte: [-128n, 127n], short: [-32768n, 32767n], int: [-2147483648n, 2147483647n],
               long: [-9223372036854775808n, 9223372036854775807n] };
const TYPES = ["byte", "short", "int", "long", "float", "double", "string",
               "compound", "list", "byteArray", "intArray", "longArray"];

const CLIP_KEY = "nbtweb-item-clip";

// Vanilla textures aren't in server jars; this CDN serves them per version.
const VANILLA_CDN = "https://raw.githubusercontent.com/InventivetalentDev/minecraft-assets/1.21.4/assets/minecraft/textures";

const VANILLA_EFFECTS = [
  "speed", "slowness", "haste", "mining_fatigue", "strength", "instant_health",
  "instant_damage", "jump_boost", "nausea", "regeneration", "resistance",
  "fire_resistance", "water_breathing", "invisibility", "blindness",
  "night_vision", "hunger", "weakness", "poison", "wither", "health_boost",
  "absorption", "saturation", "glowing", "levitation", "luck", "unluck",
  "slow_falling", "conduit_power", "dolphins_grace", "bad_omen",
  "hero_of_the_village", "darkness", "trial_omen", "raid_omen", "wind_charged",
  "weaving", "oozing", "infested",
].map((n) => "minecraft:" + n);

const VANILLA_ENCHANTS = [
  "protection", "fire_protection", "feather_falling", "blast_protection",
  "projectile_protection", "respiration", "aqua_affinity", "thorns",
  "depth_strider", "frost_walker", "binding_curse", "soul_speed", "swift_sneak",
  "sharpness", "smite", "bane_of_arthropods", "knockback", "fire_aspect",
  "looting", "sweeping_edge", "efficiency", "silk_touch", "unbreaking",
  "fortune", "power", "punch", "flame", "infinity", "luck_of_the_sea", "lure",
  "loyalty", "impaling", "riptide", "channeling", "multishot", "quick_charge",
  "piercing", "density", "breach", "wind_burst", "mending", "vanishing_curse",
].map((n) => "minecraft:" + n);

// Vanilla item/block ids (1.21.4, from PrismarineJS/minecraft-data). Server
// jars carry only modded textures, so vanilla ids must be bundled to appear
// in the item-id autocomplete; icons still resolve via VANILLA_CDN.
const VANILLA_ITEMS = [
  "acacia_boat", "acacia_button", "acacia_chest_boat", "acacia_door",
  "acacia_fence", "acacia_fence_gate", "acacia_hanging_sign",
  "acacia_leaves", "acacia_log", "acacia_planks", "acacia_pressure_plate",
  "acacia_sapling", "acacia_sign", "acacia_slab", "acacia_stairs",
  "acacia_trapdoor", "acacia_wood", "activator_rail", "air",
  "allay_spawn_egg", "allium", "amethyst_block", "amethyst_cluster",
  "amethyst_shard", "ancient_debris", "andesite", "andesite_slab",
  "andesite_stairs", "andesite_wall", "angler_pottery_sherd", "anvil",
  "apple", "archer_pottery_sherd", "armadillo_scute",
  "armadillo_spawn_egg", "armor_stand", "arms_up_pottery_sherd", "arrow",
  "axolotl_bucket", "axolotl_spawn_egg", "azalea", "azalea_leaves",
  "azure_bluet", "baked_potato", "bamboo", "bamboo_block", "bamboo_button",
  "bamboo_chest_raft", "bamboo_door", "bamboo_fence", "bamboo_fence_gate",
  "bamboo_hanging_sign", "bamboo_mosaic", "bamboo_mosaic_slab",
  "bamboo_mosaic_stairs", "bamboo_planks", "bamboo_pressure_plate",
  "bamboo_raft", "bamboo_sign", "bamboo_slab", "bamboo_stairs",
  "bamboo_trapdoor", "barrel", "barrier", "basalt", "bat_spawn_egg",
  "beacon", "bedrock", "bee_nest", "bee_spawn_egg", "beef", "beehive",
  "beetroot", "beetroot_seeds", "beetroot_soup", "bell", "big_dripleaf",
  "birch_boat", "birch_button", "birch_chest_boat", "birch_door",
  "birch_fence", "birch_fence_gate", "birch_hanging_sign", "birch_leaves",
  "birch_log", "birch_planks", "birch_pressure_plate", "birch_sapling",
  "birch_sign", "birch_slab", "birch_stairs", "birch_trapdoor",
  "birch_wood", "black_banner", "black_bed", "black_bundle",
  "black_candle", "black_carpet", "black_concrete",
  "black_concrete_powder", "black_dye", "black_glazed_terracotta",
  "black_shulker_box", "black_stained_glass", "black_stained_glass_pane",
  "black_terracotta", "black_wool", "blackstone", "blackstone_slab",
  "blackstone_stairs", "blackstone_wall", "blade_pottery_sherd",
  "blast_furnace", "blaze_powder", "blaze_rod", "blaze_spawn_egg",
  "blue_banner", "blue_bed", "blue_bundle", "blue_candle", "blue_carpet",
  "blue_concrete", "blue_concrete_powder", "blue_dye",
  "blue_glazed_terracotta", "blue_ice", "blue_orchid", "blue_shulker_box",
  "blue_stained_glass", "blue_stained_glass_pane", "blue_terracotta",
  "blue_wool", "bogged_spawn_egg", "bolt_armor_trim_smithing_template",
  "bone", "bone_block", "bone_meal", "book", "bookshelf",
  "bordure_indented_banner_pattern", "bow", "bowl", "brain_coral",
  "brain_coral_block", "brain_coral_fan", "bread", "breeze_rod",
  "breeze_spawn_egg", "brewer_pottery_sherd", "brewing_stand", "brick",
  "brick_slab", "brick_stairs", "brick_wall", "bricks", "brown_banner",
  "brown_bed", "brown_bundle", "brown_candle", "brown_carpet",
  "brown_concrete", "brown_concrete_powder", "brown_dye",
  "brown_glazed_terracotta", "brown_mushroom", "brown_mushroom_block",
  "brown_shulker_box", "brown_stained_glass", "brown_stained_glass_pane",
  "brown_terracotta", "brown_wool", "brush", "bubble_coral",
  "bubble_coral_block", "bubble_coral_fan", "bucket", "budding_amethyst",
  "bundle", "burn_pottery_sherd", "cactus", "cake", "calcite",
  "calibrated_sculk_sensor", "camel_spawn_egg", "campfire", "candle",
  "carrot", "carrot_on_a_stick", "cartography_table", "carved_pumpkin",
  "cat_spawn_egg", "cauldron", "cave_spider_spawn_egg", "chain",
  "chain_command_block", "chainmail_boots", "chainmail_chestplate",
  "chainmail_helmet", "chainmail_leggings", "charcoal", "cherry_boat",
  "cherry_button", "cherry_chest_boat", "cherry_door", "cherry_fence",
  "cherry_fence_gate", "cherry_hanging_sign", "cherry_leaves",
  "cherry_log", "cherry_planks", "cherry_pressure_plate", "cherry_sapling",
  "cherry_sign", "cherry_slab", "cherry_stairs", "cherry_trapdoor",
  "cherry_wood", "chest", "chest_minecart", "chicken", "chicken_spawn_egg",
  "chipped_anvil", "chiseled_bookshelf", "chiseled_copper",
  "chiseled_deepslate", "chiseled_nether_bricks",
  "chiseled_polished_blackstone", "chiseled_quartz_block",
  "chiseled_red_sandstone", "chiseled_resin_bricks", "chiseled_sandstone",
  "chiseled_stone_bricks", "chiseled_tuff", "chiseled_tuff_bricks",
  "chorus_flower", "chorus_fruit", "chorus_plant", "clay", "clay_ball",
  "clock", "closed_eyeblossom", "coal", "coal_block", "coal_ore",
  "coarse_dirt", "coast_armor_trim_smithing_template", "cobbled_deepslate",
  "cobbled_deepslate_slab", "cobbled_deepslate_stairs",
  "cobbled_deepslate_wall", "cobblestone", "cobblestone_slab",
  "cobblestone_stairs", "cobblestone_wall", "cobweb", "cocoa_beans", "cod",
  "cod_bucket", "cod_spawn_egg", "command_block", "command_block_minecart",
  "comparator", "compass", "composter", "conduit", "cooked_beef",
  "cooked_chicken", "cooked_cod", "cooked_mutton", "cooked_porkchop",
  "cooked_rabbit", "cooked_salmon", "cookie", "copper_block",
  "copper_bulb", "copper_door", "copper_grate", "copper_ingot",
  "copper_ore", "copper_trapdoor", "cornflower", "cow_spawn_egg",
  "cracked_deepslate_bricks", "cracked_deepslate_tiles",
  "cracked_nether_bricks", "cracked_polished_blackstone_bricks",
  "cracked_stone_bricks", "crafter", "crafting_table", "creaking_heart",
  "creaking_spawn_egg", "creeper_banner_pattern", "creeper_head",
  "creeper_spawn_egg", "crimson_button", "crimson_door", "crimson_fence",
  "crimson_fence_gate", "crimson_fungus", "crimson_hanging_sign",
  "crimson_hyphae", "crimson_nylium", "crimson_planks",
  "crimson_pressure_plate", "crimson_roots", "crimson_sign",
  "crimson_slab", "crimson_stairs", "crimson_stem", "crimson_trapdoor",
  "crossbow", "crying_obsidian", "cut_copper", "cut_copper_slab",
  "cut_copper_stairs", "cut_red_sandstone", "cut_red_sandstone_slab",
  "cut_sandstone", "cut_sandstone_slab", "cyan_banner", "cyan_bed",
  "cyan_bundle", "cyan_candle", "cyan_carpet", "cyan_concrete",
  "cyan_concrete_powder", "cyan_dye", "cyan_glazed_terracotta",
  "cyan_shulker_box", "cyan_stained_glass", "cyan_stained_glass_pane",
  "cyan_terracotta", "cyan_wool", "damaged_anvil", "dandelion",
  "danger_pottery_sherd", "dark_oak_boat", "dark_oak_button",
  "dark_oak_chest_boat", "dark_oak_door", "dark_oak_fence",
  "dark_oak_fence_gate", "dark_oak_hanging_sign", "dark_oak_leaves",
  "dark_oak_log", "dark_oak_planks", "dark_oak_pressure_plate",
  "dark_oak_sapling", "dark_oak_sign", "dark_oak_slab", "dark_oak_stairs",
  "dark_oak_trapdoor", "dark_oak_wood", "dark_prismarine",
  "dark_prismarine_slab", "dark_prismarine_stairs", "daylight_detector",
  "dead_brain_coral", "dead_brain_coral_block", "dead_brain_coral_fan",
  "dead_bubble_coral", "dead_bubble_coral_block", "dead_bubble_coral_fan",
  "dead_bush", "dead_fire_coral", "dead_fire_coral_block",
  "dead_fire_coral_fan", "dead_horn_coral", "dead_horn_coral_block",
  "dead_horn_coral_fan", "dead_tube_coral", "dead_tube_coral_block",
  "dead_tube_coral_fan", "debug_stick", "decorated_pot", "deepslate",
  "deepslate_brick_slab", "deepslate_brick_stairs", "deepslate_brick_wall",
  "deepslate_bricks", "deepslate_coal_ore", "deepslate_copper_ore",
  "deepslate_diamond_ore", "deepslate_emerald_ore", "deepslate_gold_ore",
  "deepslate_iron_ore", "deepslate_lapis_ore", "deepslate_redstone_ore",
  "deepslate_tile_slab", "deepslate_tile_stairs", "deepslate_tile_wall",
  "deepslate_tiles", "detector_rail", "diamond", "diamond_axe",
  "diamond_block", "diamond_boots", "diamond_chestplate", "diamond_helmet",
  "diamond_hoe", "diamond_horse_armor", "diamond_leggings", "diamond_ore",
  "diamond_pickaxe", "diamond_shovel", "diamond_sword", "diorite",
  "diorite_slab", "diorite_stairs", "diorite_wall", "dirt", "dirt_path",
  "disc_fragment_5", "dispenser", "dolphin_spawn_egg", "donkey_spawn_egg",
  "dragon_breath", "dragon_egg", "dragon_head", "dried_kelp",
  "dried_kelp_block", "dripstone_block", "dropper", "drowned_spawn_egg",
  "dune_armor_trim_smithing_template", "echo_shard", "egg",
  "elder_guardian_spawn_egg", "elytra", "emerald", "emerald_block",
  "emerald_ore", "enchanted_book", "enchanted_golden_apple",
  "enchanting_table", "end_crystal", "end_portal_frame", "end_rod",
  "end_stone", "end_stone_brick_slab", "end_stone_brick_stairs",
  "end_stone_brick_wall", "end_stone_bricks", "ender_chest",
  "ender_dragon_spawn_egg", "ender_eye", "ender_pearl",
  "enderman_spawn_egg", "endermite_spawn_egg", "evoker_spawn_egg",
  "experience_bottle", "explorer_pottery_sherd", "exposed_chiseled_copper",
  "exposed_copper", "exposed_copper_bulb", "exposed_copper_door",
  "exposed_copper_grate", "exposed_copper_trapdoor", "exposed_cut_copper",
  "exposed_cut_copper_slab", "exposed_cut_copper_stairs",
  "eye_armor_trim_smithing_template", "farmland", "feather",
  "fermented_spider_eye", "fern", "field_masoned_banner_pattern",
  "filled_map", "fire_charge", "fire_coral", "fire_coral_block",
  "fire_coral_fan", "firework_rocket", "firework_star", "fishing_rod",
  "fletching_table", "flint", "flint_and_steel",
  "flow_armor_trim_smithing_template", "flow_banner_pattern",
  "flow_pottery_sherd", "flower_banner_pattern", "flower_pot",
  "flowering_azalea", "flowering_azalea_leaves", "fox_spawn_egg",
  "friend_pottery_sherd", "frog_spawn_egg", "frogspawn", "furnace",
  "furnace_minecart", "ghast_spawn_egg", "ghast_tear", "gilded_blackstone",
  "glass", "glass_bottle", "glass_pane", "glistering_melon_slice",
  "globe_banner_pattern", "glow_berries", "glow_ink_sac",
  "glow_item_frame", "glow_lichen", "glow_squid_spawn_egg", "glowstone",
  "glowstone_dust", "goat_horn", "goat_spawn_egg", "gold_block",
  "gold_ingot", "gold_nugget", "gold_ore", "golden_apple", "golden_axe",
  "golden_boots", "golden_carrot", "golden_chestplate", "golden_helmet",
  "golden_hoe", "golden_horse_armor", "golden_leggings", "golden_pickaxe",
  "golden_shovel", "golden_sword", "granite", "granite_slab",
  "granite_stairs", "granite_wall", "grass_block", "gravel", "gray_banner",
  "gray_bed", "gray_bundle", "gray_candle", "gray_carpet", "gray_concrete",
  "gray_concrete_powder", "gray_dye", "gray_glazed_terracotta",
  "gray_shulker_box", "gray_stained_glass", "gray_stained_glass_pane",
  "gray_terracotta", "gray_wool", "green_banner", "green_bed",
  "green_bundle", "green_candle", "green_carpet", "green_concrete",
  "green_concrete_powder", "green_dye", "green_glazed_terracotta",
  "green_shulker_box", "green_stained_glass", "green_stained_glass_pane",
  "green_terracotta", "green_wool", "grindstone", "guardian_spawn_egg",
  "gunpowder", "guster_banner_pattern", "guster_pottery_sherd",
  "hanging_roots", "hay_block", "heart_of_the_sea", "heart_pottery_sherd",
  "heartbreak_pottery_sherd", "heavy_core",
  "heavy_weighted_pressure_plate", "hoglin_spawn_egg", "honey_block",
  "honey_bottle", "honeycomb", "honeycomb_block", "hopper",
  "hopper_minecart", "horn_coral", "horn_coral_block", "horn_coral_fan",
  "horse_spawn_egg", "host_armor_trim_smithing_template",
  "howl_pottery_sherd", "husk_spawn_egg", "ice",
  "infested_chiseled_stone_bricks", "infested_cobblestone",
  "infested_cracked_stone_bricks", "infested_deepslate",
  "infested_mossy_stone_bricks", "infested_stone", "infested_stone_bricks",
  "ink_sac", "iron_axe", "iron_bars", "iron_block", "iron_boots",
  "iron_chestplate", "iron_door", "iron_golem_spawn_egg", "iron_helmet",
  "iron_hoe", "iron_horse_armor", "iron_ingot", "iron_leggings",
  "iron_nugget", "iron_ore", "iron_pickaxe", "iron_shovel", "iron_sword",
  "iron_trapdoor", "item_frame", "jack_o_lantern", "jigsaw", "jukebox",
  "jungle_boat", "jungle_button", "jungle_chest_boat", "jungle_door",
  "jungle_fence", "jungle_fence_gate", "jungle_hanging_sign",
  "jungle_leaves", "jungle_log", "jungle_planks", "jungle_pressure_plate",
  "jungle_sapling", "jungle_sign", "jungle_slab", "jungle_stairs",
  "jungle_trapdoor", "jungle_wood", "kelp", "knowledge_book", "ladder",
  "lantern", "lapis_block", "lapis_lazuli", "lapis_ore",
  "large_amethyst_bud", "large_fern", "lava_bucket", "lead", "leather",
  "leather_boots", "leather_chestplate", "leather_helmet",
  "leather_horse_armor", "leather_leggings", "lectern", "lever", "light",
  "light_blue_banner", "light_blue_bed", "light_blue_bundle",
  "light_blue_candle", "light_blue_carpet", "light_blue_concrete",
  "light_blue_concrete_powder", "light_blue_dye",
  "light_blue_glazed_terracotta", "light_blue_shulker_box",
  "light_blue_stained_glass", "light_blue_stained_glass_pane",
  "light_blue_terracotta", "light_blue_wool", "light_gray_banner",
  "light_gray_bed", "light_gray_bundle", "light_gray_candle",
  "light_gray_carpet", "light_gray_concrete", "light_gray_concrete_powder",
  "light_gray_dye", "light_gray_glazed_terracotta",
  "light_gray_shulker_box", "light_gray_stained_glass",
  "light_gray_stained_glass_pane", "light_gray_terracotta",
  "light_gray_wool", "light_weighted_pressure_plate", "lightning_rod",
  "lilac", "lily_of_the_valley", "lily_pad", "lime_banner", "lime_bed",
  "lime_bundle", "lime_candle", "lime_carpet", "lime_concrete",
  "lime_concrete_powder", "lime_dye", "lime_glazed_terracotta",
  "lime_shulker_box", "lime_stained_glass", "lime_stained_glass_pane",
  "lime_terracotta", "lime_wool", "lingering_potion", "llama_spawn_egg",
  "lodestone", "loom", "mace", "magenta_banner", "magenta_bed",
  "magenta_bundle", "magenta_candle", "magenta_carpet", "magenta_concrete",
  "magenta_concrete_powder", "magenta_dye", "magenta_glazed_terracotta",
  "magenta_shulker_box", "magenta_stained_glass",
  "magenta_stained_glass_pane", "magenta_terracotta", "magenta_wool",
  "magma_block", "magma_cream", "magma_cube_spawn_egg", "mangrove_boat",
  "mangrove_button", "mangrove_chest_boat", "mangrove_door",
  "mangrove_fence", "mangrove_fence_gate", "mangrove_hanging_sign",
  "mangrove_leaves", "mangrove_log", "mangrove_planks",
  "mangrove_pressure_plate", "mangrove_propagule", "mangrove_roots",
  "mangrove_sign", "mangrove_slab", "mangrove_stairs", "mangrove_trapdoor",
  "mangrove_wood", "map", "medium_amethyst_bud", "melon", "melon_seeds",
  "melon_slice", "milk_bucket", "minecart", "miner_pottery_sherd",
  "mojang_banner_pattern", "mooshroom_spawn_egg", "moss_block",
  "moss_carpet", "mossy_cobblestone", "mossy_cobblestone_slab",
  "mossy_cobblestone_stairs", "mossy_cobblestone_wall",
  "mossy_stone_brick_slab", "mossy_stone_brick_stairs",
  "mossy_stone_brick_wall", "mossy_stone_bricks", "mourner_pottery_sherd",
  "mud", "mud_brick_slab", "mud_brick_stairs", "mud_brick_wall",
  "mud_bricks", "muddy_mangrove_roots", "mule_spawn_egg", "mushroom_stem",
  "mushroom_stew", "music_disc_11", "music_disc_13", "music_disc_5",
  "music_disc_blocks", "music_disc_cat", "music_disc_chirp",
  "music_disc_creator", "music_disc_creator_music_box", "music_disc_far",
  "music_disc_mall", "music_disc_mellohi", "music_disc_otherside",
  "music_disc_pigstep", "music_disc_precipice", "music_disc_relic",
  "music_disc_stal", "music_disc_strad", "music_disc_wait",
  "music_disc_ward", "mutton", "mycelium", "name_tag", "nautilus_shell",
  "nether_brick", "nether_brick_fence", "nether_brick_slab",
  "nether_brick_stairs", "nether_brick_wall", "nether_bricks",
  "nether_gold_ore", "nether_quartz_ore", "nether_sprouts", "nether_star",
  "nether_wart", "nether_wart_block", "netherite_axe", "netherite_block",
  "netherite_boots", "netherite_chestplate", "netherite_helmet",
  "netherite_hoe", "netherite_ingot", "netherite_leggings",
  "netherite_pickaxe", "netherite_scrap", "netherite_shovel",
  "netherite_sword", "netherite_upgrade_smithing_template", "netherrack",
  "note_block", "oak_boat", "oak_button", "oak_chest_boat", "oak_door",
  "oak_fence", "oak_fence_gate", "oak_hanging_sign", "oak_leaves",
  "oak_log", "oak_planks", "oak_pressure_plate", "oak_sapling", "oak_sign",
  "oak_slab", "oak_stairs", "oak_trapdoor", "oak_wood", "observer",
  "obsidian", "ocelot_spawn_egg", "ochre_froglight", "ominous_bottle",
  "ominous_trial_key", "open_eyeblossom", "orange_banner", "orange_bed",
  "orange_bundle", "orange_candle", "orange_carpet", "orange_concrete",
  "orange_concrete_powder", "orange_dye", "orange_glazed_terracotta",
  "orange_shulker_box", "orange_stained_glass",
  "orange_stained_glass_pane", "orange_terracotta", "orange_tulip",
  "orange_wool", "oxeye_daisy", "oxidized_chiseled_copper",
  "oxidized_copper", "oxidized_copper_bulb", "oxidized_copper_door",
  "oxidized_copper_grate", "oxidized_copper_trapdoor",
  "oxidized_cut_copper", "oxidized_cut_copper_slab",
  "oxidized_cut_copper_stairs", "packed_ice", "packed_mud", "painting",
  "pale_hanging_moss", "pale_moss_block", "pale_moss_carpet",
  "pale_oak_boat", "pale_oak_button", "pale_oak_chest_boat",
  "pale_oak_door", "pale_oak_fence", "pale_oak_fence_gate",
  "pale_oak_hanging_sign", "pale_oak_leaves", "pale_oak_log",
  "pale_oak_planks", "pale_oak_pressure_plate", "pale_oak_sapling",
  "pale_oak_sign", "pale_oak_slab", "pale_oak_stairs", "pale_oak_trapdoor",
  "pale_oak_wood", "panda_spawn_egg", "paper", "parrot_spawn_egg",
  "pearlescent_froglight", "peony", "petrified_oak_slab",
  "phantom_membrane", "phantom_spawn_egg", "pig_spawn_egg",
  "piglin_banner_pattern", "piglin_brute_spawn_egg", "piglin_head",
  "piglin_spawn_egg", "pillager_spawn_egg", "pink_banner", "pink_bed",
  "pink_bundle", "pink_candle", "pink_carpet", "pink_concrete",
  "pink_concrete_powder", "pink_dye", "pink_glazed_terracotta",
  "pink_petals", "pink_shulker_box", "pink_stained_glass",
  "pink_stained_glass_pane", "pink_terracotta", "pink_tulip", "pink_wool",
  "piston", "pitcher_plant", "pitcher_pod", "player_head",
  "plenty_pottery_sherd", "podzol", "pointed_dripstone",
  "poisonous_potato", "polar_bear_spawn_egg", "polished_andesite",
  "polished_andesite_slab", "polished_andesite_stairs", "polished_basalt",
  "polished_blackstone", "polished_blackstone_brick_slab",
  "polished_blackstone_brick_stairs", "polished_blackstone_brick_wall",
  "polished_blackstone_bricks", "polished_blackstone_button",
  "polished_blackstone_pressure_plate", "polished_blackstone_slab",
  "polished_blackstone_stairs", "polished_blackstone_wall",
  "polished_deepslate", "polished_deepslate_slab",
  "polished_deepslate_stairs", "polished_deepslate_wall",
  "polished_diorite", "polished_diorite_slab", "polished_diorite_stairs",
  "polished_granite", "polished_granite_slab", "polished_granite_stairs",
  "polished_tuff", "polished_tuff_slab", "polished_tuff_stairs",
  "polished_tuff_wall", "popped_chorus_fruit", "poppy", "porkchop",
  "potato", "potion", "powder_snow_bucket", "powered_rail", "prismarine",
  "prismarine_brick_slab", "prismarine_brick_stairs", "prismarine_bricks",
  "prismarine_crystals", "prismarine_shard", "prismarine_slab",
  "prismarine_stairs", "prismarine_wall", "prize_pottery_sherd",
  "pufferfish", "pufferfish_bucket", "pufferfish_spawn_egg", "pumpkin",
  "pumpkin_pie", "pumpkin_seeds", "purple_banner", "purple_bed",
  "purple_bundle", "purple_candle", "purple_carpet", "purple_concrete",
  "purple_concrete_powder", "purple_dye", "purple_glazed_terracotta",
  "purple_shulker_box", "purple_stained_glass",
  "purple_stained_glass_pane", "purple_terracotta", "purple_wool",
  "purpur_block", "purpur_pillar", "purpur_slab", "purpur_stairs",
  "quartz", "quartz_block", "quartz_bricks", "quartz_pillar",
  "quartz_slab", "quartz_stairs", "rabbit", "rabbit_foot", "rabbit_hide",
  "rabbit_spawn_egg", "rabbit_stew", "rail",
  "raiser_armor_trim_smithing_template", "ravager_spawn_egg", "raw_copper",
  "raw_copper_block", "raw_gold", "raw_gold_block", "raw_iron",
  "raw_iron_block", "recovery_compass", "red_banner", "red_bed",
  "red_bundle", "red_candle", "red_carpet", "red_concrete",
  "red_concrete_powder", "red_dye", "red_glazed_terracotta",
  "red_mushroom", "red_mushroom_block", "red_nether_brick_slab",
  "red_nether_brick_stairs", "red_nether_brick_wall", "red_nether_bricks",
  "red_sand", "red_sandstone", "red_sandstone_slab",
  "red_sandstone_stairs", "red_sandstone_wall", "red_shulker_box",
  "red_stained_glass", "red_stained_glass_pane", "red_terracotta",
  "red_tulip", "red_wool", "redstone", "redstone_block", "redstone_lamp",
  "redstone_ore", "redstone_torch", "reinforced_deepslate", "repeater",
  "repeating_command_block", "resin_block", "resin_brick",
  "resin_brick_slab", "resin_brick_stairs", "resin_brick_wall",
  "resin_bricks", "resin_clump", "respawn_anchor",
  "rib_armor_trim_smithing_template", "rooted_dirt", "rose_bush",
  "rotten_flesh", "saddle", "salmon", "salmon_bucket", "salmon_spawn_egg",
  "sand", "sandstone", "sandstone_slab", "sandstone_stairs",
  "sandstone_wall", "scaffolding", "scrape_pottery_sherd", "sculk",
  "sculk_catalyst", "sculk_sensor", "sculk_shrieker", "sculk_vein",
  "sea_lantern", "sea_pickle", "seagrass",
  "sentry_armor_trim_smithing_template",
  "shaper_armor_trim_smithing_template", "sheaf_pottery_sherd", "shears",
  "sheep_spawn_egg", "shelter_pottery_sherd", "shield", "short_grass",
  "shroomlight", "shulker_box", "shulker_shell", "shulker_spawn_egg",
  "silence_armor_trim_smithing_template", "silverfish_spawn_egg",
  "skeleton_horse_spawn_egg", "skeleton_skull", "skeleton_spawn_egg",
  "skull_banner_pattern", "skull_pottery_sherd", "slime_ball",
  "slime_block", "slime_spawn_egg", "small_amethyst_bud", "small_dripleaf",
  "smithing_table", "smoker", "smooth_basalt", "smooth_quartz",
  "smooth_quartz_slab", "smooth_quartz_stairs", "smooth_red_sandstone",
  "smooth_red_sandstone_slab", "smooth_red_sandstone_stairs",
  "smooth_sandstone", "smooth_sandstone_slab", "smooth_sandstone_stairs",
  "smooth_stone", "smooth_stone_slab", "sniffer_egg", "sniffer_spawn_egg",
  "snort_pottery_sherd", "snout_armor_trim_smithing_template", "snow",
  "snow_block", "snow_golem_spawn_egg", "snowball", "soul_campfire",
  "soul_lantern", "soul_sand", "soul_soil", "soul_torch", "spawner",
  "spectral_arrow", "spider_eye", "spider_spawn_egg",
  "spire_armor_trim_smithing_template", "splash_potion", "sponge",
  "spore_blossom", "spruce_boat", "spruce_button", "spruce_chest_boat",
  "spruce_door", "spruce_fence", "spruce_fence_gate",
  "spruce_hanging_sign", "spruce_leaves", "spruce_log", "spruce_planks",
  "spruce_pressure_plate", "spruce_sapling", "spruce_sign", "spruce_slab",
  "spruce_stairs", "spruce_trapdoor", "spruce_wood", "spyglass",
  "squid_spawn_egg", "stick", "sticky_piston", "stone", "stone_axe",
  "stone_brick_slab", "stone_brick_stairs", "stone_brick_wall",
  "stone_bricks", "stone_button", "stone_hoe", "stone_pickaxe",
  "stone_pressure_plate", "stone_shovel", "stone_slab", "stone_stairs",
  "stone_sword", "stonecutter", "stray_spawn_egg", "strider_spawn_egg",
  "string", "stripped_acacia_log", "stripped_acacia_wood",
  "stripped_bamboo_block", "stripped_birch_log", "stripped_birch_wood",
  "stripped_cherry_log", "stripped_cherry_wood", "stripped_crimson_hyphae",
  "stripped_crimson_stem", "stripped_dark_oak_log",
  "stripped_dark_oak_wood", "stripped_jungle_log", "stripped_jungle_wood",
  "stripped_mangrove_log", "stripped_mangrove_wood", "stripped_oak_log",
  "stripped_oak_wood", "stripped_pale_oak_log", "stripped_pale_oak_wood",
  "stripped_spruce_log", "stripped_spruce_wood", "stripped_warped_hyphae",
  "stripped_warped_stem", "structure_block", "structure_void", "sugar",
  "sugar_cane", "sunflower", "suspicious_gravel", "suspicious_sand",
  "suspicious_stew", "sweet_berries", "tadpole_bucket",
  "tadpole_spawn_egg", "tall_grass", "target", "terracotta",
  "tide_armor_trim_smithing_template", "tinted_glass", "tipped_arrow",
  "tnt", "tnt_minecart", "torch", "torchflower", "torchflower_seeds",
  "totem_of_undying", "trader_llama_spawn_egg", "trapped_chest",
  "trial_key", "trial_spawner", "trident", "tripwire_hook",
  "tropical_fish", "tropical_fish_bucket", "tropical_fish_spawn_egg",
  "tube_coral", "tube_coral_block", "tube_coral_fan", "tuff",
  "tuff_brick_slab", "tuff_brick_stairs", "tuff_brick_wall", "tuff_bricks",
  "tuff_slab", "tuff_stairs", "tuff_wall", "turtle_egg", "turtle_helmet",
  "turtle_scute", "turtle_spawn_egg", "twisting_vines", "vault",
  "verdant_froglight", "vex_armor_trim_smithing_template", "vex_spawn_egg",
  "villager_spawn_egg", "vindicator_spawn_egg", "vine",
  "wandering_trader_spawn_egg", "ward_armor_trim_smithing_template",
  "warden_spawn_egg", "warped_button", "warped_door", "warped_fence",
  "warped_fence_gate", "warped_fungus", "warped_fungus_on_a_stick",
  "warped_hanging_sign", "warped_hyphae", "warped_nylium", "warped_planks",
  "warped_pressure_plate", "warped_roots", "warped_sign", "warped_slab",
  "warped_stairs", "warped_stem", "warped_trapdoor", "warped_wart_block",
  "water_bucket", "waxed_chiseled_copper", "waxed_copper_block",
  "waxed_copper_bulb", "waxed_copper_door", "waxed_copper_grate",
  "waxed_copper_trapdoor", "waxed_cut_copper", "waxed_cut_copper_slab",
  "waxed_cut_copper_stairs", "waxed_exposed_chiseled_copper",
  "waxed_exposed_copper", "waxed_exposed_copper_bulb",
  "waxed_exposed_copper_door", "waxed_exposed_copper_grate",
  "waxed_exposed_copper_trapdoor", "waxed_exposed_cut_copper",
  "waxed_exposed_cut_copper_slab", "waxed_exposed_cut_copper_stairs",
  "waxed_oxidized_chiseled_copper", "waxed_oxidized_copper",
  "waxed_oxidized_copper_bulb", "waxed_oxidized_copper_door",
  "waxed_oxidized_copper_grate", "waxed_oxidized_copper_trapdoor",
  "waxed_oxidized_cut_copper", "waxed_oxidized_cut_copper_slab",
  "waxed_oxidized_cut_copper_stairs", "waxed_weathered_chiseled_copper",
  "waxed_weathered_copper", "waxed_weathered_copper_bulb",
  "waxed_weathered_copper_door", "waxed_weathered_copper_grate",
  "waxed_weathered_copper_trapdoor", "waxed_weathered_cut_copper",
  "waxed_weathered_cut_copper_slab", "waxed_weathered_cut_copper_stairs",
  "wayfinder_armor_trim_smithing_template", "weathered_chiseled_copper",
  "weathered_copper", "weathered_copper_bulb", "weathered_copper_door",
  "weathered_copper_grate", "weathered_copper_trapdoor",
  "weathered_cut_copper", "weathered_cut_copper_slab",
  "weathered_cut_copper_stairs", "weeping_vines", "wet_sponge", "wheat",
  "wheat_seeds", "white_banner", "white_bed", "white_bundle",
  "white_candle", "white_carpet", "white_concrete",
  "white_concrete_powder", "white_dye", "white_glazed_terracotta",
  "white_shulker_box", "white_stained_glass", "white_stained_glass_pane",
  "white_terracotta", "white_tulip", "white_wool",
  "wild_armor_trim_smithing_template", "wind_charge", "witch_spawn_egg",
  "wither_rose", "wither_skeleton_skull", "wither_skeleton_spawn_egg",
  "wither_spawn_egg", "wolf_armor", "wolf_spawn_egg", "wooden_axe",
  "wooden_hoe", "wooden_pickaxe", "wooden_shovel", "wooden_sword",
  "writable_book", "written_book", "yellow_banner", "yellow_bed",
  "yellow_bundle", "yellow_candle", "yellow_carpet", "yellow_concrete",
  "yellow_concrete_powder", "yellow_dye", "yellow_glazed_terracotta",
  "yellow_shulker_box", "yellow_stained_glass",
  "yellow_stained_glass_pane", "yellow_terracotta", "yellow_wool",
  "zoglin_spawn_egg", "zombie_head", "zombie_horse_spawn_egg",
  "zombie_spawn_egg", "zombie_villager_spawn_egg",
  "zombified_piglin_spawn_egg",
].map((n) => "minecraft:" + n);

// Vanilla max-durability values (1.21.4, from PrismarineJS/minecraft-data).
// Only items with maxDurability > 0 are listed. Used to bound the durability
// slider for vanilla items that carry no minecraft:max_damage component in NBT.
const VANILLA_MAX_DAMAGE = {
  "minecraft:wooden_sword": 59,    "minecraft:wooden_shovel": 59,
  "minecraft:wooden_pickaxe": 59,  "minecraft:wooden_axe": 59,
  "minecraft:wooden_hoe": 59,
  "minecraft:stone_sword": 131,    "minecraft:stone_shovel": 131,
  "minecraft:stone_pickaxe": 131,  "minecraft:stone_axe": 131,
  "minecraft:stone_hoe": 131,
  "minecraft:iron_sword": 250,     "minecraft:iron_shovel": 250,
  "minecraft:iron_pickaxe": 250,   "minecraft:iron_axe": 250,
  "minecraft:iron_hoe": 250,
  "minecraft:golden_sword": 32,    "minecraft:golden_shovel": 32,
  "minecraft:golden_pickaxe": 32,  "minecraft:golden_axe": 32,
  "minecraft:golden_hoe": 32,
  "minecraft:diamond_sword": 1561, "minecraft:diamond_shovel": 1561,
  "minecraft:diamond_pickaxe": 1561, "minecraft:diamond_axe": 1561,
  "minecraft:diamond_hoe": 1561,
  "minecraft:netherite_sword": 2031, "minecraft:netherite_shovel": 2031,
  "minecraft:netherite_pickaxe": 2031, "minecraft:netherite_axe": 2031,
  "minecraft:netherite_hoe": 2031,
  "minecraft:leather_helmet": 55,  "minecraft:leather_chestplate": 80,
  "minecraft:leather_leggings": 75, "minecraft:leather_boots": 65,
  "minecraft:chainmail_helmet": 165, "minecraft:chainmail_chestplate": 240,
  "minecraft:chainmail_leggings": 225, "minecraft:chainmail_boots": 195,
  "minecraft:iron_helmet": 165,    "minecraft:iron_chestplate": 240,
  "minecraft:iron_leggings": 225,  "minecraft:iron_boots": 195,
  "minecraft:golden_helmet": 77,   "minecraft:golden_chestplate": 112,
  "minecraft:golden_leggings": 105, "minecraft:golden_boots": 91,
  "minecraft:diamond_helmet": 363, "minecraft:diamond_chestplate": 528,
  "minecraft:diamond_leggings": 495, "minecraft:diamond_boots": 429,
  "minecraft:netherite_helmet": 407, "minecraft:netherite_chestplate": 592,
  "minecraft:netherite_leggings": 555, "minecraft:netherite_boots": 481,
  "minecraft:turtle_helmet": 275,
  "minecraft:bow": 384,            "minecraft:crossbow": 326,
  "minecraft:trident": 250,        "minecraft:fishing_rod": 64,
  "minecraft:shears": 238,         "minecraft:flint_and_steel": 64,
  "minecraft:carrot_on_a_stick": 25, "minecraft:warped_fungus_on_a_stick": 100,
  "minecraft:elytra": 432,         "minecraft:shield": 336,
  "minecraft:brush": 64,           "minecraft:mace": 500,
  "minecraft:wolf_armor": 64,
};

function setStatus(msg, cls) {
  const el = $("status");
  if (!msg) { el.hidden = true; return; }
  el.hidden = false;
  el.textContent = msg;
  el.className = cls || "";
}

function setDirty(d) {
  dirty = d;
  if (d && file) file._paths = null;   // tag-path index is stale after edits
  $("dirty").hidden = !d;
  $("save").disabled = !d;
}

// ---------------------------------------------------------------- fuzzy

function fuzzyScore(query, text) {
  const q = query.toLowerCase(), t = text.toLowerCase();
  let qi = 0, score = 0, last = -2;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] !== q[qi]) continue;
    score += (ti === last + 1) ? 3 : 1;
    if (ti === 0 || " /_-.:".includes(t[ti - 1])) score += 2;
    last = ti; qi++;
  }
  return qi === q.length ? score : -1;
}

// -------------------------------------------------------------- sidebar

function flatEntries() {
  const out = [];
  for (const s of tree.servers) {
    for (const p of s.players || [])
      for (const f of p.files)
        out.push({ label: `${s.name} / ${p.label} / ${f.label}`, sub: "player", path: f.path });
    for (const w of s.worlds) {
      out.push({ label: `${s.name} / ${w.name}`, sub: "level.dat", path: w.level });
      for (const d of w.data)
        out.push({ label: `${s.name} / ${w.name} / ${d.label}`, sub: "data", path: d.path });
      for (const d of w.playerdata || [])
        out.push({ label: `${s.name} / ${w.name} / playerdata / ${d.label}`, sub: "playerdata", path: d.path });
    }
  }
  return out;
}

function fileRow(label, path) {
  const row = document.createElement("div");
  row.className = "node-row";
  row.dataset.path = path;
  row.appendChild(document.createTextNode(label));
  row.addEventListener("click", () => openFile(path, label, row));
  if (file && file.path === path) { row.classList.add("active"); activeRow = row; }
  return row;
}

// onOpen: clicking the row opens something in the editor (server overview,
// player's playerdata) and always expands; the caret alone toggles collapse.
function groupRow(label, key, count, childrenEl, onOpen) {
  const row = document.createElement("div");
  row.className = "node-row";
  const caret = document.createElement("span");
  caret.className = "caret";
  row.appendChild(caret);
  row.appendChild(document.createTextNode(label));
  if (count != null) {
    const c = document.createElement("span");
    c.className = "count";
    c.textContent = count;
    row.appendChild(c);
  }
  const sync = () => {
    const open = sbOpen.has(key);
    caret.textContent = open ? "▾" : "▸";
    childrenEl.hidden = !open;
  };
  caret.addEventListener("click", (ev) => {
    ev.stopPropagation();
    sbOpen.has(key) ? sbOpen.delete(key) : sbOpen.add(key);
    sync();
  });
  row.addEventListener("click", () => {
    if (onOpen) {
      sbOpen.add(key);
      sync();
      onOpen();
      return;
    }
    sbOpen.has(key) ? sbOpen.delete(key) : sbOpen.add(key);
    sync();
  });
  sync();
  return row;
}

function renderSidebar() {
  const query = $("search").value.trim();
  const el = $("tree");
  el.textContent = "";
  activeRow = null;

  if (query) {
    const ranked = flatEntries()
      .map((e) => ({ ...e, score: fuzzyScore(query, e.label + " " + e.sub) }))
      .filter((e) => e.score >= 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 200);
    if (!ranked.length) {
      const d = document.createElement("div");
      d.className = "group-label";
      d.textContent = "no matches";
      el.appendChild(d);
      return;
    }
    for (const e of ranked) el.appendChild(fileRow(e.label, e.path));
    return;
  }

  for (const s of tree.servers) {
    const kids = document.createElement("div");
    kids.className = "tree-indent";

    for (const p of s.players || []) {
      const pkids = document.createElement("div");
      pkids.className = "tree-indent";
      for (const f of p.files) pkids.appendChild(fileRow(f.label, f.path));
      const pd = p.files[0]; // playerdata is always first
      kids.appendChild(groupRow(p.label, `${s.name}/p/${p.uuid}`,
        p.files.length > 1 ? p.files.length : null, pkids,
        () => openFile(pd.path, `${s.name} / ${p.label} / ${pd.label}`)));
      kids.appendChild(pkids);
    }

    for (const w of s.worlds) {
      const wkids = document.createElement("div");
      wkids.className = "tree-indent";
      wkids.appendChild(fileRow("level.dat", w.level));
      if (w.data.length) {
        const dkids = document.createElement("div");
        dkids.className = "tree-indent";
        for (const d of w.data) dkids.appendChild(fileRow(d.label, d.path));
        wkids.appendChild(groupRow("data", `${s.name}/${w.name}/d`, w.data.length, dkids));
        wkids.appendChild(dkids);
      }
      const pd = w.playerdata || [];
      if (pd.length) {
        const pkids2 = document.createElement("div");
        pkids2.className = "tree-indent";
        for (const d of pd) pkids2.appendChild(fileRow(d.label, d.path));
        wkids.appendChild(groupRow("playerdata", `${s.name}/${w.name}/pd`, pd.length, pkids2));
        wkids.appendChild(pkids2);
      }
      kids.appendChild(groupRow(w.name, `${s.name}/${w.name}`, null, wkids));
      kids.appendChild(wkids);
    }
    const nP = (s.players || []).length;
    el.appendChild(groupRow(s.name, s.name,
      (nP ? nP + " players · " : "") + s.worlds.length + " worlds", kids,
      () => openServerView(s)));
    el.appendChild(kids);
  }
}

// ------------------------------------------------------------ raw tree

function typeLabel(node) {
  if (node.t === "list") {
    const et = node.v.length ? node.v[0].t : "?";
    return `list<${et}>`;
  }
  return node.t;
}

function validateScalar(t, raw) {
  if (t === "string") return raw;
  if (t === "float" || t === "double") {
    const f = Number(raw);
    if (!isFinite(f)) throw new Error("not a number");
    return f;
  }
  let big;
  try { big = BigInt(raw.trim()); } catch { throw new Error("not an integer"); }
  const [lo, hi] = NUMS[t];
  if (big < lo || big > hi) throw new Error(`out of ${t} range`);
  return t === "long" ? big.toString() : Number(big);
}

function defaultValue(t) {
  if (t === "compound") return {};
  if (CONTAINERS.has(t)) return [];
  if (t === "string") return "";
  if (t === "long") return "0";
  return 0;
}

function inlineEdit(span, initial, commit) {
  const input = document.createElement("input");
  input.className = "nbt-edit";
  input.value = initial;
  input.size = Math.max(6, Math.min(60, initial.length + 2));
  span.replaceWith(input);
  input.focus();
  input.select();
  let done = false;
  const finish = (apply) => {
    if (done) return;
    done = true;
    if (apply) {
      try { commit(input.value); }
      catch (e) { setStatus(String(e.message || e), "err"); }
    }
    renderEditor();
  };
  input.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") finish(true);
    if (ev.key === "Escape") finish(false);
  });
  input.addEventListener("blur", () => finish(true));
}

function matchesFilter(node, key, q) {
  if (!q) return true;
  if (String(key).toLowerCase().includes(q)) return true;
  if (node.t === "compound")
    return Object.entries(node.v).some(([k, c]) => matchesFilter(c, k, q));
  if (node.t === "list")
    return node.v.some((c, i) => matchesFilter(c, i, q));
  if (!CONTAINERS.has(node.t))
    return String(node.v).toLowerCase().includes(q);
  return false;
}

function renderNode(node, key, path, parent, q) {
  const wrap = document.createElement("div");
  wrap.className = "nbt-node";
  const row = document.createElement("div");
  row.className = "nbt-row";
  wrap.appendChild(row);

  const isContainer = CONTAINERS.has(node.t);
  const isOpen = expanded.has(path);

  const caret = document.createElement("span");
  caret.className = "nbt-caret";
  caret.textContent = isContainer ? (isOpen ? "▾" : "▸") : "";
  if (isContainer)
    caret.addEventListener("click", () => {
      isOpen ? expanded.delete(path) : expanded.add(path);
      renderEditor();
    });
  row.appendChild(caret);

  const keyEl = document.createElement("span");
  keyEl.className = "nbt-key";
  keyEl.textContent = key;
  if (parent && parent.rename) {
    keyEl.classList.add("editable");
    keyEl.title = "click to rename";
    keyEl.addEventListener("click", () =>
      inlineEdit(keyEl, String(key), (raw) => {
        if (raw !== String(key)) { parent.rename(raw); setDirty(true); }
      }));
  }
  row.appendChild(keyEl);

  const typeEl = document.createElement("span");
  typeEl.className = "nbt-type";
  typeEl.textContent = typeLabel(node);
  row.appendChild(typeEl);

  if (isContainer) {
    const n = node.t === "compound" ? Object.keys(node.v).length : node.v.length;
    const count = document.createElement("span");
    count.className = "nbt-count";
    count.textContent = `${n} ${n === 1 ? "entry" : "entries"}`;
    row.appendChild(count);
  } else {
    const val = document.createElement("span");
    val.className = "nbt-value" + (node.t === "string" ? " str" : "");
    val.textContent = String(node.v);
    val.title = "click to edit";
    val.addEventListener("click", () =>
      inlineEdit(val, String(node.v), (raw) => {
        node.v = validateScalar(node.t, raw);
        setDirty(true);
        setStatus(null);
      }));
    row.appendChild(val);
  }

  // anything that holds actual items opens in the inventory editor
  const invStyle = isDirectItemList(node) ? "direct"
                 : isWrappedItemList(node) ? "wrapped" : null;
  if (invStyle) {
    const openInv = document.createElement("button");
    openInv.className = "mini-btn inv-open";
    openInv.textContent = "open as inventory";
    openInv.addEventListener("click", () =>
      openInventoryModal(String(key), node, invStyle));
    row.appendChild(openInv);
  }

  const actions = document.createElement("span");
  actions.className = "row-actions";
  if (isContainer) {
    const add = document.createElement("button");
    add.className = "mini-btn";
    add.textContent = "+";
    add.title = "add entry";
    add.addEventListener("click", () => {
      expanded.add(path);
      showAddForm(wrap, node);
    });
    actions.appendChild(add);
  }
  if (parent) {
    const del = document.createElement("button");
    del.className = "mini-btn del";
    del.textContent = "×";
    del.title = "delete";
    del.addEventListener("click", () => {
      parent.remove();
      setDirty(true);
      renderEditor();
    });
    actions.appendChild(del);
  }
  row.appendChild(actions);

  if (isContainer && isOpen) {
    const kids = document.createElement("div");
    kids.className = "nbt-children";
    if (node.t === "compound") {
      for (const k of Object.keys(node.v)) {
        if (!matchesFilter(node.v[k], k, q)) continue;
        kids.appendChild(renderNode(node.v[k], k, path + "." + k, {
          remove: () => delete node.v[k],
          rename: (nk) => {
            if (nk in node.v) throw new Error("key already exists");
            const rebuilt = {};
            for (const kk of Object.keys(node.v)) rebuilt[kk === k ? nk : kk] = node.v[kk];
            node.v = rebuilt;
          },
        }, q));
      }
    } else if (node.t === "list") {
      node.v.forEach((c, i) => {
        if (!matchesFilter(c, i, q)) return;
        kids.appendChild(renderNode(c, i, path + "[" + i + "]", {
          remove: () => node.v.splice(i, 1),
        }, q));
      });
    } else {
      const et = node.t === "byteArray" ? "byte" : node.t === "intArray" ? "int" : "long";
      node.v.forEach((c, i) => {
        kids.appendChild(renderNode({ t: et, get v() { return node.v[i]; },
                                      set v(x) { node.v[i] = x; } },
                                    i, path + "[" + i + "]", {
          remove: () => node.v.splice(i, 1),
        }, q));
      });
    }
    wrap.appendChild(kids);
  }
  return wrap;
}

function showAddForm(wrap, node) {
  const old = wrap.querySelector(".add-form");
  if (old) { old.remove(); renderEditor(); return; }

  const form = document.createElement("div");
  form.className = "add-form";

  let nameInput = null;
  if (node.t === "compound") {
    nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.placeholder = "key name";
    form.appendChild(nameInput);
  }

  let typeSel = null;
  const listEmpty = node.t === "list" && node.v.length === 0;
  if (node.t === "compound" || listEmpty) {
    typeSel = document.createElement("select");
    for (const t of TYPES) {
      const o = document.createElement("option");
      o.value = t; o.textContent = t;
      typeSel.appendChild(o);
    }
    form.appendChild(typeSel);
  }

  const ok = document.createElement("button");
  ok.className = "mini-btn";
  ok.textContent = "add";
  ok.addEventListener("click", () => {
    try {
      if (node.t === "compound") {
        const k = nameInput.value.trim();
        if (!k) throw new Error("name required");
        if (k in node.v) throw new Error("key already exists");
        const t = typeSel.value;
        node.v[k] = { t, v: defaultValue(t) };
      } else if (node.t === "list") {
        const t = listEmpty ? typeSel.value : node.v[0].t;
        node.v.push({ t, v: defaultValue(t) });
      } else {
        node.v.push(node.t === "longArray" ? "0" : 0);
      }
      setDirty(true);
      setStatus(null);
      renderEditor();
    } catch (e) { setStatus(String(e.message || e), "err"); }
  });
  form.appendChild(ok);

  const cancel = document.createElement("button");
  cancel.className = "mini-btn";
  cancel.textContent = "cancel";
  cancel.addEventListener("click", () => renderEditor());
  form.appendChild(cancel);

  wrap.appendChild(form);
  (nameInput || typeSel || ok).focus();
}

// --------------------------------------------------------- shared bits

function isPlayerFile(f) {
  return /(^|\/)playerdata\//.test(f.path) && f.root.t === "compound";
}

function fileServer() {
  if (file) return file.path.split("/")[0];
  if (currentServer) return currentServer.name;
  return "";
}

function playerCtx(path) {
  if (!tree) return null;
  for (const s of tree.servers)
    for (const p of s.players || [])
      if (p.files.some((f) => f.path === path)) return { server: s, player: p };
  return null;
}

function tpath(root, path) {
  let n = root;
  for (const k of path.split(".")) {
    if (!n || n.t !== "compound") return undefined;
    n = n.v[k];
  }
  return n;
}

function dataVersion() {
  const dv = tpath(file.root, "DataVersion");
  return dv ? Number(dv.v) : 0;
}

function shortId(id) {
  return id.startsWith("minecraft:") ? id.slice(10) : id;
}

// resolved item models, memoised per server+id (many stacks share one id)
const _modelCache = new Map();
function resolveModel(id) {
  const key = fileServer() + "|" + id;
  let p = _modelCache.get(key);
  if (!p) {
    p = fetch(`/api/model?server=${encodeURIComponent(fileServer())}&id=${encodeURIComponent(id)}`)
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
    _modelCache.set(key, p);
  }
  return p;
}

// icon fallback: server mod jars -> vanilla CDN -> nothing (text stays)
function attachIcon(box, id, kind) {
  const [ns, name] = id.includes(":") ? id.split(":", 2) : ["minecraft", id];
  const img = document.createElement("img");
  img.alt = "";
  img.draggable = false;
  box.appendChild(img);
  const play = (urls) => {
    let i = 0;
    img.onerror = () => {
      i++;
      if (i < urls.length) img.src = urls[i];
      else { img.remove(); box.classList.remove("has-icon"); }
    };
    img.onload = () => box.classList.add("has-icon");
    if (urls.length) img.src = urls[0];
    else { img.remove(); box.classList.remove("has-icon"); }
  };

  const server = encodeURIComponent(fileServer());
  const iconUrl = `/api/icon?server=${server}&id=${encodeURIComponent(id)}` +
                  (kind === "effect" ? "&kind=effect" : "");
  const cdn = [];
  if (ns === "minecraft") {
    if (kind === "effect") cdn.push(`${VANILLA_CDN}/mob_effect/${name}.png`);
    else cdn.push(`${VANILLA_CDN}/item/${name}.png`, `${VANILLA_CDN}/block/${name}.png`);
  }
  // Vanilla and effects have no minecraft: model in the jars (effects use a
  // dedicated index), so keep the existing icon -> CDN chain.
  if (ns === "minecraft" || kind === "effect") { play([iconUrl, ...cdn]); return; }

  // Modded item: resolve its model so we serve the RIGHT texture (a basename
  // guess can collide with an unrelated item) and never blank out — a
  // representative texture (particle / first texture) beats an empty slot.
  const texUrl = (rl) => `/api/texture?server=${server}&id=${encodeURIComponent(rl)}`;
  resolveModel(id).then((doc) => {
    const urls = [];
    if (doc && doc.textures) {
      if (doc.kind === "flat" && doc.textures.layer0) urls.push(texUrl(doc.textures.layer0));
      const rep = doc.particle || doc.textures.layer0 || Object.values(doc.textures)[0];
      if (rep) urls.push(texUrl(rep));
    }
    urls.push(iconUrl, ...cdn);
    play([...new Set(urls)]);
  });
}

function iconBox(id, kind, cls) {
  const box = document.createElement("span");
  box.className = cls || "mini-icon";
  attachIcon(box, id, kind);
  return box;
}

// ------------------------------------------------------- form building

function card(title, full) {
  const c = document.createElement("div");
  c.className = "card" + (full ? " full" : "");
  if (title) {
    const h = document.createElement("div");
    h.className = "card-title";
    h.textContent = title;
    c.appendChild(h);
  }
  const body = document.createElement("div");
  body.className = "card-body";
  c.appendChild(body);
  c.body = body;
  return c;
}

function frow(body, label) {
  const r = document.createElement("div");
  r.className = "frow";
  const l = document.createElement("span");
  l.className = "flabel";
  l.textContent = label;
  r.appendChild(l);
  const ctls = document.createElement("div");
  ctls.className = "fctls";
  r.appendChild(ctls);
  body.appendChild(r);
  return ctls;
}

function boundInput(node, cls) {
  const input = document.createElement("input");
  input.type = "text";
  input.className = "pv-input" + (cls ? " " + cls : "");
  input.value = node.v;
  const commit = () => {
    if (String(node.v) === input.value.trim()) return;
    try {
      node.v = validateScalar(node.t, input.value);
      input.value = node.v;
      input.classList.remove("bad");
      setDirty(true);
      setStatus(null);
    } catch (e) {
      input.classList.add("bad");
      setStatus(String(e.message || e), "err");
    }
  };
  input.addEventListener("change", commit);
  input.addEventListener("keydown", (ev) => { if (ev.key === "Enter") commit(); });
  return input;
}

function addNum(ctls, node, cls) {
  if (node && !CONTAINERS.has(node.t)) ctls.appendChild(boundInput(node, cls));
}

// labelled row that is simply omitted when the tag is absent
function numRow(body, label, node, cls) {
  if (!node || CONTAINERS.has(node.t)) return null;
  const ctls = frow(body, label);
  ctls.appendChild(boundInput(node, cls));
  return ctls;
}

// bare toggle bound to a byte-boolean node (0/1); shared by switchRow and the
// generic item-tag renderer.
function makeSwitch(node) {
  const sw = document.createElement("div");
  sw.className = "sw" + (node.v ? " on" : "");
  const knob = document.createElement("div");
  knob.className = "knob";
  sw.appendChild(knob);
  sw.addEventListener("click", () => {
    node.v = node.v ? 0 : 1;
    sw.classList.toggle("on", !!node.v);
    setDirty(true);
  });
  return sw;
}

function switchRow(body, label, node) {
  if (!node) return;
  frow(body, label).appendChild(makeSwitch(node));
}

// house mini slider: inset track, accent-dark fill, round accent handle
function miniSlider(min, max, val, step, onInput) {
  const el = document.createElement("div");
  el.className = "msl";
  const track = document.createElement("div");
  track.className = "msl-track";
  const fill = document.createElement("div");
  fill.className = "msl-fill";
  const handle = document.createElement("div");
  handle.className = "msl-handle";
  track.appendChild(fill);
  track.appendChild(handle);
  el.appendChild(track);
  let cur = val;
  const set = (v) => {
    cur = Math.max(min, Math.min(max, v));
    const f = max > min ? (cur - min) / (max - min) : 0;
    fill.style.width = (f * 100) + "%";
    handle.style.left = `calc(${f * 100}% - 6px)`;
  };
  const fromEvent = (ev) => {
    const rect = track.getBoundingClientRect();
    let f = (ev.clientX - rect.left) / rect.width;
    f = Math.max(0, Math.min(1, f));
    let v = min + f * (max - min);
    if (step) v = Math.round(v / step) * step;
    set(v);
    onInput(cur);
  };
  el.addEventListener("pointerdown", (ev) => {
    el.setPointerCapture(ev.pointerId);
    fromEvent(ev);
    const move = (e2) => fromEvent(e2);
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  });
  set(val);
  return { el, set, get: () => cur };
}

// ---------------------------------------------------------------- modals

const MODALS = [];

function modalShell(title, wide) {
  const ov = document.createElement("div");
  ov.className = "modal-overlay";
  const box = document.createElement("div");
  box.className = "modal" + (wide ? " wide" : "");
  ov.appendChild(box);
  const head = document.createElement("div");
  head.className = "modal-head";
  const t = document.createElement("span");
  t.className = "modal-title";
  t.textContent = title;
  head.appendChild(t);
  const x = document.createElement("button");
  x.className = "mini-btn del";
  x.textContent = "×";
  head.appendChild(x);
  box.appendChild(head);
  const body = document.createElement("div");
  body.className = "modal-body";
  box.appendChild(body);
  const shell = { ov, body, close: () => {
    const i = MODALS.indexOf(shell);
    if (i >= 0) MODALS.splice(i, 1);
    ov.remove();
  }};
  x.addEventListener("click", shell.close);
  ov.addEventListener("mousedown", (ev) => { if (ev.target === ov) shell.close(); });
  document.body.appendChild(ov);
  MODALS.push(shell);
  return shell;
}

document.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape" && MODALS.length) {
    ev.stopPropagation();
    MODALS[MODALS.length - 1].close();
  }
});

// ---------------------------------------------- inventory (reusable)
//
// The browser renders any list of item-shaped compounds: the player view
// hosts one over the whole file, the raw tree can open any recognized
// container list in a modal, and both drill into nested sub-inventories
// (shulker component containers, backpack Items lists, …) with a crumb
// trail. State {rootKey, stack, query} is per-host.

// a resource location like "minecraft:diamond" or "matteroverdrive:android_battery"
const RES_LOC = /^[a-z0-9_.\-]+:[a-z0-9_./\-]+$/i;
// keys that mark an id-bearing compound as a stored ITEM rather than something
// else that also carries an id (mob effects → amplifier/duration; attributes →
// base; attribute modifiers → amount/operation; block entities → …). A stack
// count, slot, or item payload. Deliberately NOT "amount" (that's an attribute
// modifier's field — item stack size is always count/Count).
const ITEM_MARK_KEYS = ["count", "Count", "Slot", "slot",
                        "components", "tag", "Damage", "damage"];

function itemIdOf(n) {
  if (!n || n.t !== "compound" || !n.v) return null;
  const id = n.v.id;
  return (id && id.t === "string" && RES_LOC.test(id.v)) ? id.v : null;
}

// Mod- and version-agnostic: anything with a resource-location id plus an
// item-ish marker is treated as a stored item, so modded inventories
// (curios/baubles/aether, matter-overdrive android parts, …) surface without
// per-mod knowledge. (An empty container has no items to recognise — unknowable.)
function isItemCompound(n) {
  return itemIdOf(n) != null && ITEM_MARK_KEYS.some((k) => k in n.v);
}

function isDirectItemList(n) {
  return n && n.t === "list" && n.v.length > 0 &&
    n.v.every((e) => e.t === "compound") && n.v.some(isItemCompound);
}

function isWrappedItemList(n) {
  return n && n.t === "list" && n.v.length > 0 &&
    n.v.every((e) => e.t === "compound") &&
    n.v.some((e) => e.v && isItemCompound(e.v.item));
}

const ACC = {
  direct: {
    slotOf: (e, i) => (e.v.Slot ? Number(e.v.Slot.v) : i),
    itemOf: (e) => e,
  },
  wrapped: {
    slotOf: (e, i) => (e.v.slot ? Number(e.v.slot.v) : i),
    itemOf: (e) => e.v.item,
  },
};

// a slot/handler's own name, used to label a container nicely (curios
// Identifier = "head"/"ring"/…, a mekanism frequency name, a keyed tank, …)
const NAME_KEYS = ["Identifier", "Name", "name", "Type", "type", "key"];
// generic wrapper segments worth hiding from a label — these are container
// plumbing, not information (curios/accessories/forge cap boilerplate).
const NOISE_SEG = new Set([
  "neoforge:attachments", "ForgeCaps", "cardinal_components", "Curios",
  "StacksHandler", "Stacks", "Items", "Inventory", "inventory", "Contents",
  "contents", "items", "Handler", "handler", "inventory_holder", "ItemStacks",
]);

function nameOf(comp) {
  if (comp && comp.t === "compound")
    for (const k of NAME_KEYS) {
      const v = comp.v[k];
      if (v && v.t === "string" && v.v) return v.v;
    }
  return null;
}

function cleanLabel(parts) {
  const kept = parts.filter((p) => !NOISE_SEG.has(p) && !/^#\d+$/.test(p));
  return (kept.length ? kept : parts).join(" / ") || "items";
}

// Walk the whole file for item lists. Crucially this descends INTO non-item
// lists too — modded inventories nest the real item list inside handler lists
// (curios: Curios[i].StacksHandler.Stacks.Items) — while stopping at a genuine
// item list so a container's own items (e.g. a backpack's contents) aren't
// re-surfaced as separate top-level inventories.
function findItemLists(node) {
  const out = [];
  (function walk(n, path, parts, depth) {
    if (!n || depth > 20 || out.length >= 100) return;
    if (n.t === "list") {
      if (isDirectItemList(n)) { out.push({ path, label: cleanLabel(parts), node: n, style: "direct" }); return; }
      if (isWrappedItemList(n)) { out.push({ path, label: cleanLabel(parts), node: n, style: "wrapped" }); return; }
      n.v.forEach((c, i) => {                       // descend into handler/holder lists
        if (c && c.t === "compound")
          walk(c, `${path}[${i}]`, parts.concat(nameOf(c) || `#${i}`), depth + 1);
      });
      return;
    }
    if (n.t === "compound")
      for (const k of Object.keys(n.v))
        walk(n.v[k], path ? path + "." + k : k, parts.concat(k), depth + 1);
  })(node, "", [], 0);
  return out;
}

// ---- blanket "stack" model: an item OR a fluid/chemical, wherever stored ----
//
// A stack is a compound carrying a resource-location name plus a quantity. That
// one shape covers vanilla/modded ITEMS ({id, count/Count, components/tag}),
// FLUIDS ({FluidName, Amount}) and mekanism-style CHEMICALS ({gasName, amount},
// …) — so tanks, ender-chest frequencies, curios, backpacks etc. are all found
// by shape, with no per-mod code. Effects/attributes carry an id too but are
// excluded by their giveaway keys.

const STACK_ID_KEYS = ["id", "FluidName", "fluid", "gasName", "slurryName",
                       "pigmentName", "infuseTypeName"];
const STACK_QTY_KEYS = ["count", "Count", "amount", "Amount"];
const NON_STACK_KEYS = ["operation", "base", "amplifier", "duration"];

function stackInfo(n) {
  if (!n || n.t !== "compound" || !n.v) return null;
  if (NON_STACK_KEYS.some((k) => k in n.v)) return null;
  const idKey = STACK_ID_KEYS.find((k) => n.v[k] && n.v[k].t === "string" && RES_LOC.test(n.v[k].v));
  if (!idKey) return null;
  const qtyKey = STACK_QTY_KEYS.find((k) => n.v[k] && !CONTAINERS.has(n.v[k].t));
  if (!qtyKey && !("components" in n.v) && !("tag" in n.v)) return null;
  return { kind: idKey === "id" ? "item" : "fluid", idKey, qtyKey, node: n };
}

const pathLeaf = (p) => (p.split(/[.[]/).filter(Boolean).pop() || p).replace(/]/g, "");

// Every stack in the file, grouped by its nearest named container (a mekanism
// frequency's name, a curios slot's Identifier, a keyed tank, else the holding
// list/key). `owner` (a list + index) is set only when the stack — or its
// single wrapper — is a direct list element, so deletion removes just that slot.
function findStacks(root) {
  const out = [];
  (function walk(n, key, group, sinceList, owner, depth) {
    if (!n || depth > 24 || out.length >= 600) return;
    const s = stackInfo(n);
    if (s) {
      out.push({ ...s, group: group || { key: key || "root", label: pathLeaf(key) || "items" },
                 owner: (owner && sinceList <= 1) ? owner : null });
      return;
    }
    if (n.t === "list") {
      const direct = n.v.some(stackInfo);
      const listGroup = group || (direct ? { key: key, label: pathLeaf(key) } : null);
      n.v.forEach((c, i) => {
        if (!c) return;
        const cg = direct ? listGroup
          : { key: `${key}[${i}]`, label: nameOf(c) || `${pathLeaf(key)} ${i + 1}` };
        walk(c, `${key}[${i}]`, cg, 0, { list: n, index: i }, depth + 1);
      });
      return;
    }
    if (n.t === "compound")
      for (const k of Object.keys(n.v))
        walk(n.v[k], key ? key + "." + k : k, group, sinceList + 1, owner, depth + 1);
  })(root, "", null, 99, null, 0);
  return out;
}

function storageGroups(root) {
  const groups = new Map();
  for (const s of findStacks(root)) {
    let g = groups.get(s.group.key);
    if (!g) { g = { label: s.group.label, stacks: [] }; groups.set(s.group.key, g); }
    g.stacks.push(s);
  }
  return groups;
}

// every inventory-shaped list in the file: Inventory + EnderItems first,
// then anything else holding actual items (curios/baubles/accessories/
// aether/mod attachments), labelled by its path
function discoverInventories() {
  const out = [];
  const seen = new Set();
  const push = (key, label, node, style) => {
    if (!seen.has(key)) { seen.add(key); out.push({ key, label, node, style }); }
  };
  const inv = file.root.v.Inventory, end = file.root.v.EnderItems;
  if (inv && inv.t === "list") push("Inventory", "inventory", inv, "direct");
  if (end && end.t === "list") push("EnderItems", "ender chest", end, "direct");
  for (const f of findItemLists(file.root))
    if (f.path !== "Inventory" && f.path !== "EnderItems")
      push(f.path, f.label, f.node, f.style);
  return out;
}

function countKeyFor(listNode, style) {
  if (style === "wrapped") return "count";
  for (const it of listNode.v) {
    if (it.t === "compound") {
      if ("count" in it.v) return "count";
      if ("Count" in it.v) return "Count";
    }
  }
  return dataVersion() >= 3837 ? "count" : "Count";
}

function maxStackFor(id) {
  const n = shortId(id);
  if (/(sword|pickaxe|_axe$|^axe_|shovel|hoe$|helmet|chestplate|leggings|boots|^bow$|crossbow|trident|shield|elytra|potion$|bucket|saddle|shears|fishing_rod|flint_and_steel|shulker_box|_bed$|boat$|minecart|backpack|totem|broom)/.test(n))
    return 1;
  if (/(ender_pearl|snowball|^egg$|_sign$|honey_bottle|armor_stand|banner$)/.test(n))
    return 16;
  return 64;
}

// ---- enchantments (modern components map / legacy tag.Enchantments)

function readEnchants(item) {
  if (!item) return [];
  const out = [];
  const comp = item.v.components;
  const e = comp && comp.t === "compound" && comp.v["minecraft:enchantments"];
  if (e && e.t === "compound") {
    const map = (e.v.levels && e.v.levels.t === "compound") ? e.v.levels : e;
    for (const [k, v] of Object.entries(map.v))
      if (!CONTAINERS.has(v.t)) out.push({ id: k, lvl: Number(v.v) });
    return out;
  }
  const tag = item.v.tag;
  const legacy = tag && tag.t === "compound" && tag.v.Enchantments;
  if (legacy && legacy.t === "list")
    for (const en of legacy.v)
      if (en.t === "compound" && en.v.id)
        out.push({ id: String(en.v.id.v), lvl: Number(en.v.lvl ? en.v.lvl.v : 1) });
  return out;
}

function writeEnchants(item, enchants) {
  const hasComp = item.v.components && item.v.components.t === "compound";
  const hasTag = item.v.tag && item.v.tag.t === "compound";
  const modern = hasComp || (!hasTag && dataVersion() >= 3837);
  const norm = enchants
    .filter((e) => e.id.trim())
    .map((e) => ({ id: e.id.includes(":") ? e.id.trim() : "minecraft:" + e.id.trim(),
                   lvl: Math.max(1, Math.round(Number(e.lvl) || 1)) }));
  if (modern) {
    if (!norm.length) {
      if (hasComp) delete item.v.components.v["minecraft:enchantments"];
      return;
    }
    if (!hasComp) item.v.components = { t: "compound", v: {} };
    const existing = item.v.components.v["minecraft:enchantments"];
    const map = { t: "compound", v: {} };
    for (const e of norm) map.v[e.id] = { t: "int", v: e.lvl };
    if (existing && existing.t === "compound" && existing.v.levels &&
        existing.v.levels.t === "compound")
      item.v.components.v["minecraft:enchantments"] = { t: "compound", v: { ...existing.v, levels: map } };
    else
      item.v.components.v["minecraft:enchantments"] = map;
  } else {
    if (!norm.length) {
      if (hasTag) delete item.v.tag.v.Enchantments;
      return;
    }
    if (!hasTag) item.v.tag = { t: "compound", v: {} };
    item.v.tag.v.Enchantments = { t: "list", v: norm.map((e) => ({
      t: "compound", v: { id: { t: "string", v: e.id }, lvl: { t: "short", v: e.lvl } },
    }))};
  }
}

// ---- item clipboard (localStorage: survives switching files)

function clipRead() {
  try { return JSON.parse(localStorage.getItem(CLIP_KEY)); } catch { return null; }
}

function clipWrite(item) {
  const clone = JSON.parse(JSON.stringify(item));
  delete clone.v.Slot;
  delete clone.v.slot;
  localStorage.setItem(CLIP_KEY, JSON.stringify(clone));
}

function clipToEntry(pane, slot) {
  const item = clipRead();
  if (!item) return null;
  const cnt = Number((item.v.count || item.v.Count || {}).v || 1);
  delete item.v.count;
  delete item.v.Count;
  const ck = countKeyFor(pane.node, pane.style);
  if (pane.style === "direct") {
    item.v.Slot = { t: "byte", v: slot };
    item.v[ck] = { t: ck === "count" ? "int" : "byte", v: cnt };
    return item;
  }
  item.v.count = { t: "int", v: cnt };
  return { t: "compound", v: { slot: { t: "int", v: slot }, item } };
}

// Cut the item at (pane, slot) onto the clipboard and remove it. Mirrors the
// modal "cut" button; returns the item node, or null if the slot is empty.
function cutSlot(pane, slot) {
  const acc = ACC[pane.style];
  const idx = pane.node.v.findIndex((e, i) => acc.slotOf(e, i) === slot);
  if (idx < 0) return null;
  const entry = pane.node.v[idx];
  const item = acc.itemOf(entry);
  clipWrite(pane.style === "wrapped" ? item : entry);
  pane.node.v.splice(idx, 1);
  return item;
}

// Paste the clipboard into (pane, slot), replacing any occupant. Mirrors the
// modal "paste" button; returns true if something was pasted.
function pasteClipInto(pane, slot) {
  const ne = clipToEntry(pane, slot);
  if (!ne) return false;
  const acc = ACC[pane.style];
  const idx = pane.node.v.findIndex((e, i) => acc.slotOf(e, i) === slot);
  if (idx >= 0) pane.node.v.splice(idx, 1, ne);
  else pane.node.v.push(ne);
  return true;
}

// Move the item from a source slot to a destination slot by reusing the exact
// cut+paste (clipboard) logic: cut source -> paste into dest. If the dest is
// occupied its former item is sent back to the source slot (swap). Returns
// true on a change.
function moveSlot(srcPane, srcSlot, dstPane, dstSlot) {
  if (srcPane === dstPane && srcSlot === dstSlot) return false;
  const dacc = ACC[dstPane.style];
  const dIdx = dstPane.node.v.findIndex((e, i) => dacc.slotOf(e, i) === dstSlot);
  let dstStash = null;
  if (dIdx >= 0) {
    const dEntry = dstPane.node.v[dIdx];
    dstStash = JSON.parse(JSON.stringify(
      dstPane.style === "wrapped" ? dacc.itemOf(dEntry) : dEntry));
  }
  if (!cutSlot(srcPane, srcSlot)) return false;
  pasteClipInto(dstPane, dstSlot);
  if (dstStash) {
    clipWrite(dstStash);
    pasteClipInto(srcPane, srcSlot);
  }
  return true;
}

// ---- generic item-tag editor (every nbt tag / data-component on an item,
// with a control derived from the tag TYPE — no per-item special-casing)

function compV(item) { const c = item.v.components; return c && c.t === "compound" ? c.v : null; }
function tagV(item)  { const t = item.v.tag;        return t && t.t === "compound" ? t.v : null; }

// NBT has no boolean type; booleans are byte 0/1. Treat those as toggles, every
// other numeric (incl. bytes outside 0/1) as a number box.
function isBoolNode(node) { return node.t === "byte" && (node.v === 0 || node.v === 1); }
function isScalar(node)   { return node && !CONTAINERS.has(node.t); }

function typeBadge(node) {
  const b = document.createElement("span");
  b.className = "nbt-type";
  b.textContent = typeLabel(node);
  return b;
}

// DURABILITY: property-based via the modern damage components. A slider shows
// when max_damage is present (the max is a real property, never guessed), OR
// when the item id is a known vanilla item with durability (synthetic mode).
function durabilityInfo(comp, id, itemV) {
  if (comp) {
    const maxNode = comp["minecraft:max_damage"];
    if (isScalar(maxNode)) {
      const max = Number(maxNode.v);
      if (max > 0) return { max, comp, maxNode, dmgNode: comp["minecraft:damage"] || null };
    }
  }
  if (!id) return null;
  const synthMax = VANILLA_MAX_DAMAGE[id];
  if (!(synthMax > 0)) return null;
  return { max: synthMax, comp: comp || null, maxNode: null,
           dmgNode: (comp && comp["minecraft:damage"]) || null,
           synthetic: true, itemV: itemV || null };
}

// ENERGY: standard Forge/NeoForge energy. Detect by a scalar key named "energy"
// (namespace-stripped, case-insensitive) sitting beside a capacity key. A slider
// needs a real max, so it shows only when a capacity property is discoverable;
// otherwise the energy value falls through to the generic number box.
function energyInfo(item, comp, tag) {
  const bare = (k) => (k.includes(":") ? k.slice(k.indexOf(":") + 1) : k);
  for (const scope of [item.v, comp, tag].filter(Boolean)) {
    let node = null;
    for (const k of Object.keys(scope))
      if (/^energy$/i.test(bare(k)) && isScalar(scope[k])) { node = scope[k]; break; }
    if (!node) continue;
    let maxNode = null;
    for (const k of Object.keys(scope))
      if (/^(max_?energy|energy_?capacity|capacity)$/i.test(bare(k)) && isScalar(scope[k])) {
        maxNode = scope[k]; break;
      }
    if (maxNode && Number(maxNode.v) > 0) return { node, maxNode };
  }
  return null;
}

function durabilityRow(body, dur) {
  const ctls = frow(body, "durability");
  const readout = document.createElement("span");
  readout.className = "pv-label msl-pct";
  const curDmg = () => (dur.dmgNode ? Number(dur.dmgNode.v) : 0);
  const upd = (rem) => { readout.textContent = Math.round(rem) + " / " + dur.max; };
  const sl = miniSlider(0, dur.max, dur.max - curDmg(), 1, (rem) => {
    const dmg = Math.max(0, Math.min(dur.max, Math.round(dur.max - rem)));
    if (dur.synthetic) {
      // Bootstrap the components compound if the item had none, then insert
      // minecraft:max_damage so subsequent reads see the real node.
      if (!dur.comp) {
        dur.comp = {};
        if (dur.itemV) dur.itemV.components = { t: "compound", v: dur.comp };
      }
      if (!dur.comp["minecraft:max_damage"]) {
        dur.comp["minecraft:max_damage"] = { t: "int", v: dur.max };
      }
    }
    if (!dur.dmgNode) { dur.dmgNode = { t: "int", v: 0 }; dur.comp["minecraft:damage"] = dur.dmgNode; }
    dur.dmgNode.v = dmg;
    upd(rem);
    setDirty(true);
  });
  upd(dur.max - curDmg());
  ctls.appendChild(sl.el);
  ctls.appendChild(readout);
}

function energyRow(body, en) {
  const ctls = frow(body, "energy");
  const max = Number(en.maxNode.v);
  const box = boundInput(en.node, "num");
  const readout = document.createElement("span");
  readout.className = "pv-label msl-pct";
  readout.textContent = "/ " + max;
  const sl = miniSlider(0, max, Number(en.node.v), 1, (v) => {
    en.node.v = validateScalar(en.node.t, String(Math.round(v)));
    box.value = en.node.v;
    setDirty(true);
  });
  box.addEventListener("input", () => { const n = Number(box.value); if (isFinite(n)) sl.set(n); });
  ctls.appendChild(sl.el);
  ctls.appendChild(box);
  ctls.appendChild(readout);
}

// one editable field, control chosen from the tag type; containers expand into
// a nested tree (lazily built) so list/compound keep working without regressing
// the raw-nbt tab.
function renderItemField(body, key, node, consumed) {
  if (!node || consumed.has(node)) return;
  const ctls = frow(body, String(key));
  const row = ctls.parentElement;
  const lbl = row.querySelector(".flabel");
  if (lbl) lbl.title = String(key);

  if (CONTAINERS.has(node.t)) {
    const kids = document.createElement("div");
    kids.className = "nbt-children";
    kids.style.display = "none";
    const caret = document.createElement("button");
    caret.className = "mini-btn";
    caret.textContent = "▸";
    let open = false, built = false;
    caret.addEventListener("click", () => {
      open = !open;
      caret.textContent = open ? "▾" : "▸";
      kids.style.display = open ? "" : "none";
      if (open && !built) { built = true; buildItemChildren(kids, node, consumed); }
    });
    ctls.appendChild(caret);
    ctls.appendChild(typeBadge(node));
    const n = node.t === "compound" ? Object.keys(node.v).length : node.v.length;
    const cnt = document.createElement("span");
    cnt.className = "nbt-count";
    cnt.textContent = n + (n === 1 ? " entry" : " entries");
    ctls.appendChild(cnt);
    row.after(kids);
  } else if (isBoolNode(node)) {
    ctls.appendChild(makeSwitch(node));
    ctls.appendChild(typeBadge(node));
  } else {
    ctls.appendChild(boundInput(node, node.t === "string" ? "wide" : "num"));
    ctls.appendChild(typeBadge(node));
  }
}

function buildItemChildren(wrap, node, consumed) {
  if (node.t === "compound") {
    for (const k of Object.keys(node.v)) renderItemField(wrap, k, node.v[k], consumed);
  } else if (node.t === "list") {
    node.v.forEach((c, i) => renderItemField(wrap, i, c, consumed));
  } else {
    const et = node.t === "byteArray" ? "byte" : node.t === "intArray" ? "int" : "long";
    node.v.forEach((_, i) => renderItemField(wrap, i,
      { t: et, get v() { return node.v[i]; }, set v(x) { node.v[i] = x; } }, consumed));
  }
}

// Renders every remaining tag/component on the item (those without a dedicated
// control above) plus the durability/energy sliders when applicable.
function renderItemAllTags(body, item) {
  if (!item || !item.v) return;
  const consumed = new Set();
  const mark = (n) => { if (n) consumed.add(n); };
  mark(item.v.id); mark(item.v.count); mark(item.v.Count);
  mark(item.v.Slot); mark(item.v.slot);
  const comp = compV(item), tag = tagV(item);
  if (comp && comp["minecraft:enchantments"]) mark(comp["minecraft:enchantments"]);
  if (tag && tag.Enchantments) mark(tag.Enchantments);

  const sec = document.createElement("div");
  sec.className = "im-ench";
  const title = document.createElement("div");
  title.className = "card-title";
  title.textContent = "nbt / components";
  sec.appendChild(title);
  const rows = document.createElement("div");
  sec.appendChild(rows);

  const itemId = item.v.id ? item.v.id.v : null;
  const dur = durabilityInfo(comp, itemId, item.v);
  if (dur) { mark(dur.maxNode); mark(dur.dmgNode); durabilityRow(rows, dur); }
  const en = energyInfo(item, comp, tag);
  if (en) { mark(en.node); mark(en.maxNode); energyRow(rows, en); }

  for (const k of Object.keys(item.v)) {
    if (k === "tag" || k === "components") continue;   // flattened below
    renderItemField(rows, k, item.v[k], consumed);
  }
  if (comp) for (const k of Object.keys(comp)) renderItemField(rows, k, comp[k], consumed);
  if (tag)  for (const k of Object.keys(tag))  renderItemField(rows, k, tag[k], consumed);

  if (rows.childElementCount > 0) body.appendChild(sec);
}

// ---- item modal

function openItemModal(pane, slot, rerender) {
  const acc = ACC[pane.style];
  const idx = pane.node.v.findIndex((e, i) => acc.slotOf(e, i) === slot);
  const entry = idx >= 0 ? pane.node.v[idx] : null;
  const item = entry ? acc.itemOf(entry) : null;

  const shell = modalShell("slot " + slot);
  const b = shell.body;

  const head = document.createElement("div");
  head.className = "im-head";
  const combo = comboBox({
    options: itemIds,
    placeholder: "minecraft:diamond",
    initial: item ? String(item.v.id.v) : "",
    iconKind: "item",
  });
  head.appendChild(combo.el);
  b.appendChild(head);

  // count: slider capped at the stack size, number box free to exceed it
  const cRow = document.createElement("div");
  cRow.className = "im-row";
  const cLabel = document.createElement("span");
  cLabel.className = "flabel";
  cLabel.textContent = "count";
  cRow.appendChild(cLabel);
  const cInput = document.createElement("input");
  cInput.type = "text";
  cInput.className = "pv-input count";
  cInput.value = item ? String((item.v.count || item.v.Count || {}).v || 1) : "1";
  const slider = miniSlider(1, maxStackFor(combo.value() || "x"), Number(cInput.value) || 1, 1,
    (v) => { cInput.value = v; });
  cRow.appendChild(slider.el);
  cRow.appendChild(cInput);
  b.appendChild(cRow);
  cInput.addEventListener("input", () => slider.set(Number(cInput.value) || 1));

  // enchantments
  const enchWrap = document.createElement("div");
  enchWrap.className = "im-ench";
  const enchTitle = document.createElement("div");
  enchTitle.className = "card-title";
  enchTitle.textContent = "enchantments";
  enchWrap.appendChild(enchTitle);
  const enchRows = document.createElement("div");
  enchWrap.appendChild(enchRows);
  const enchants = readEnchants(item);
  const renderEnch = () => {
    enchRows.textContent = "";
    enchants.forEach((e, i) => {
      const r = document.createElement("div");
      r.className = "ench-row";
      const idc = comboBox({
        options: VANILLA_ENCHANTS,
        placeholder: "minecraft:sharpness",
        initial: e.id,
        onChange: (v) => { e.id = v; },
      });
      r.appendChild(idc.el);
      const lvl = document.createElement("input");
      lvl.type = "text";
      lvl.className = "pv-input count";
      lvl.value = e.lvl;
      lvl.addEventListener("input", () => { e.lvl = lvl.value; });
      r.appendChild(lvl);
      const del = document.createElement("button");
      del.className = "mini-btn del";
      del.textContent = "×";
      del.addEventListener("click", () => { enchants.splice(i, 1); renderEnch(); });
      r.appendChild(del);
      enchRows.appendChild(r);
    });
    const add = document.createElement("button");
    add.className = "mini-btn";
    add.textContent = "+ add enchantment";
    add.addEventListener("click", () => { enchants.push({ id: "minecraft:", lvl: 1 }); renderEnch(); });
    enchRows.appendChild(add);
  };
  renderEnch();
  b.appendChild(enchWrap);

  // every remaining nbt tag / data-component, typed control per field
  renderItemAllTags(b, item);

  // footer
  const foot = document.createElement("div");
  foot.className = "modal-foot";
  if (item) {
    const copy = document.createElement("button");
    copy.className = "btn";
    copy.textContent = "copy";
    copy.addEventListener("click", () => {
      clipWrite(pane.style === "wrapped" ? item : entry);
      setStatus("copied " + shortId(String(item.v.id.v)), "ok");
      shell.close();
    });
    foot.appendChild(copy);
    const cut = document.createElement("button");
    cut.className = "btn";
    cut.textContent = "cut";
    cut.addEventListener("click", () => {
      cutSlot(pane, slot);
      setDirty(true);
      setStatus("cut " + shortId(String(item.v.id.v)), "ok");
      shell.close();
      rerender();
    });
    foot.appendChild(cut);
  }
  if (clipRead()) {
    const paste = document.createElement("button");
    paste.className = "btn";
    paste.textContent = "paste";
    paste.addEventListener("click", () => {
      if (!pasteClipInto(pane, slot)) return;
      setDirty(true);
      shell.close();
      rerender();
    });
    foot.appendChild(paste);
  }
  const spacer = document.createElement("span");
  spacer.className = "spacer";
  foot.appendChild(spacer);
  if (entry) {
    const del = document.createElement("button");
    del.className = "btn danger";
    del.textContent = "delete";
    del.addEventListener("click", () => {
      pane.node.v.splice(idx, 1);
      setDirty(true);
      shell.close();
      rerender();
    });
    foot.appendChild(del);
  }
  const cancel = document.createElement("button");
  cancel.className = "btn";
  cancel.textContent = "cancel";
  cancel.addEventListener("click", shell.close);
  foot.appendChild(cancel);
  const apply = document.createElement("button");
  apply.className = "btn primary";
  apply.textContent = item ? "apply" : "add";
  apply.addEventListener("click", () => {
    try {
      let id = combo.value().trim();
      if (!id) throw new Error("item id required");
      if (!id.includes(":")) id = "minecraft:" + id;
      const count = Number(cInput.value);
      if (!Number.isInteger(count) || count < 1) throw new Error("count must be a positive integer");
      const ck = countKeyFor(pane.node, pane.style);
      let target = item;
      if (!target) {
        if (pane.style === "direct") {
          target = { t: "compound", v: {
            Slot: { t: "byte", v: slot },
            id: { t: "string", v: id },
            [ck]: { t: ck === "count" ? "int" : "byte", v: count },
          }};
          pane.node.v.push(target);
        } else {
          target = { t: "compound", v: { id: { t: "string", v: id }, count: { t: "int", v: count } } };
          pane.node.v.push({ t: "compound", v: { slot: { t: "int", v: slot }, item: target } });
        }
      } else {
        target.v.id.v = id;
        const cn = target.v.count || target.v.Count;
        if (cn) cn.v = count;
        else target.v[ck] = { t: ck === "count" ? "int" : "byte", v: count };
      }
      writeEnchants(target, enchants);
      setDirty(true);
      setStatus(null);
      shell.close();
      rerender();
    } catch (e) { setStatus(String(e.message || e), "err"); }
  });
  foot.appendChild(apply);
  b.appendChild(foot);
  combo.input.focus();
}

// ---- slot grid

// live drag source: { pane, slot }. Object refs stay valid because no rerender
// happens between dragstart and drop.
let dragSrc = null;

const ARMOR_SLOTS = [
  [103, "head"], [102, "chest"], [101, "legs"], [100, "feet"], [-106, "offhand"],
];

function range(a, b) {
  return Array.from({ length: b - a + 1 }, (_, i) => [a + i, null]);
}

function slotCell(pane, slot, entry, caption, state, rerender) {
  const acc = ACC[pane.style];
  const item = entry ? acc.itemOf(entry) : null;
  const cell = document.createElement("div");
  cell.className = "slot";
  const box = document.createElement("div");
  box.className = "icon-box" + (item ? "" : " empty");
  cell.appendChild(box);

  if (item) {
    const id = String(item.v.id.v);
    cell.dataset.q = shortId(id) + " " + id;
    cell.title = id;
    if (state.query && fuzzyScore(state.query, cell.dataset.q) < 0)
      cell.classList.add("dimmed");
    const n = document.createElement("div");
    n.className = "iname";
    n.textContent = shortId(id);
    box.appendChild(n);
    attachIcon(box, id, "item");
    const cn = item.v.count || item.v.Count;
    if (cn && Number(cn.v) !== 1) {
      const c = document.createElement("div");
      c.className = "icount";
      c.textContent = cn.v;
      box.appendChild(c);
    }
    const subs = findItemLists(item);
    if (subs.length) {
      box.classList.add("has-sub");
      const m = document.createElement("div");
      m.className = "isub";
      m.textContent = "▸";
      box.appendChild(m);
      box.addEventListener("dblclick", () => {
        state.stack.push({
          label: shortId(id),
          panes: subs.map((s) => ({ caption: s.path, node: s.node, style: s.style })),
        });
        rerender();
      });
    }
    const name = document.createElement("div");
    name.className = "slot-name";
    name.textContent = shortId(id);
    cell.appendChild(name);
  } else if (caption) {
    const c = document.createElement("div");
    c.className = "icap";
    c.textContent = caption;
    box.appendChild(c);
  }

  box.addEventListener("click", () => openItemModal(pane, slot, rerender));

  // drag-and-drop: dragging a filled slot onto another slot cuts+pastes (moves)
  // the item, swapping when the target is occupied. Reuses moveSlot (the shared
  // clipboard cut/paste logic). Click-to-open is preserved (drag suppresses it).
  if (item) {
    cell.draggable = true;
    cell.addEventListener("dragstart", (e) => {
      dragSrc = { pane, slot };
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", String(slot));
      cell.classList.add("dragging");
    });
    cell.addEventListener("dragend", () => {
      dragSrc = null;
      cell.classList.remove("dragging");
    });
  }
  cell.addEventListener("dragover", (e) => {
    if (!dragSrc) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    cell.classList.add("drop-hover");
  });
  cell.addEventListener("dragleave", () => cell.classList.remove("drop-hover"));
  cell.addEventListener("drop", (e) => {
    cell.classList.remove("drop-hover");
    if (!dragSrc) return;
    e.preventDefault();
    const src = dragSrc;
    dragSrc = null;
    if (moveSlot(src.pane, src.slot, pane, slot)) {
      setDirty(true);
      rerender();
    }
  });
  return cell;
}

function paneRows(pane, bySlot) {
  const maxSlot = Math.max(26, ...bySlot.keys());
  const rows = [];
  const cap = maxSlot <= 53 ? maxSlot : 26;
  for (let a = 0; a <= cap; a += 9)
    rows.push(range(a, Math.min(a + 8, cap)));
  return rows;
}

function renderPane(pane, state, rerender) {
  const bySlot = new Map();
  pane.node.v.forEach((e, i) => bySlot.set(ACC[pane.style].slotOf(e, i), e));

  const wrap = document.createElement("div");
  wrap.className = "inv-flex";
  const left = document.createElement("div");
  left.className = "inv-col";
  wrap.appendChild(left);

  let drawn;
  if (pane.rootKey === "Inventory") {
    // main + hotbar left, armor column on the right
    for (const r of [range(9, 17), range(18, 26), range(27, 35)]) {
      const row = document.createElement("div");
      row.className = "inv-row";
      for (const c of r) left.appendChild(row), row.appendChild(slotCell(pane, c[0], bySlot.get(c[0]), c[1], state, rerender));
      left.appendChild(row);
    }
    const hot = document.createElement("div");
    hot.className = "inv-row gap";
    for (const c of range(0, 8)) hot.appendChild(slotCell(pane, c[0], bySlot.get(c[0]), c[1], state, rerender));
    left.appendChild(hot);
    const armor = document.createElement("div");
    armor.className = "armor-col";
    for (const [slot, cap] of ARMOR_SLOTS)
      armor.appendChild(slotCell(pane, slot, bySlot.get(slot), cap, state, rerender));
    wrap.appendChild(armor);
    drawn = new Set([...range(0, 35).map((c) => c[0]), ...ARMOR_SLOTS.map((a) => a[0])]);
  } else {
    for (const r of paneRows(pane, bySlot)) {
      const row = document.createElement("div");
      row.className = "inv-row";
      for (const c of r) row.appendChild(slotCell(pane, c[0], bySlot.get(c[0]), null, state, rerender));
      left.appendChild(row);
    }
    drawn = new Set(paneRows(pane, bySlot).flat().map((c) => c[0]));
  }

  const extras = [...bySlot.keys()].filter((n) => !drawn.has(n)).sort((a, b) => a - b);
  if (extras.length) {
    const row = document.createElement("div");
    row.className = "inv-row gap";
    for (const n of extras) row.appendChild(slotCell(pane, n, bySlot.get(n), "slot " + n, state, rerender));
    left.appendChild(row);
  }
  return wrap;
}

// roots: [{key,label,node,style}]; state mutated in place
function renderInventoryBrowser(roots, state, rerender) {
  const host = document.createElement("div");
  host.className = "inv-browser";
  if (!roots.length) {
    const d = document.createElement("div");
    d.className = "pv-hint";
    d.textContent = "nothing inventory-shaped here";
    host.appendChild(d);
    return host;
  }

  let panes;
  if (state.stack.length) panes = state.stack[state.stack.length - 1].panes;
  else {
    const root = roots.find((r) => r.key === state.rootKey) || roots[0];
    state.rootKey = root.key;
    panes = [{ caption: null, node: root.node, style: root.style,
               rootKey: root.key === "Inventory" ? "Inventory" : null }];
  }

  // crumb bar
  const bar = document.createElement("div");
  bar.className = "crumb-bar";
  const sel = document.createElement("select");
  sel.className = "pv-select";
  for (const r of roots) {
    const o = document.createElement("option");
    o.value = r.key;
    o.textContent = r.label;
    sel.appendChild(o);
  }
  sel.value = state.rootKey;
  sel.addEventListener("change", () => {
    state.rootKey = sel.value;
    state.stack = [];
    rerender();
  });
  bar.appendChild(sel);
  state.stack.forEach((level, i) => {
    const sep = document.createElement("span");
    sep.className = "crumb-sep";
    sep.textContent = "/";
    bar.appendChild(sep);
    const seg = document.createElement("button");
    seg.className = "crumb" + (i === state.stack.length - 1 ? " here" : "");
    seg.textContent = level.label;
    seg.addEventListener("click", () => {
      state.stack.length = i + 1;
      rerender();
    });
    bar.appendChild(seg);
  });
  if (state.stack.length) {
    const up = document.createElement("button");
    up.className = "crumb";
    up.textContent = "↩";
    up.title = "up one level";
    up.addEventListener("click", () => { state.stack.pop(); rerender(); });
    bar.appendChild(up);
  }
  const spacer = document.createElement("span");
  spacer.className = "crumb-spacer";
  bar.appendChild(spacer);
  const search = document.createElement("input");
  search.type = "text";
  search.className = "pv-input";
  search.placeholder = "find item…";
  search.value = state.query;
  search.addEventListener("input", () => {
    state.query = search.value.trim();
    for (const cell of host.querySelectorAll(".slot"))
      cell.classList.toggle("dimmed",
        !!state.query && !!cell.dataset.q && fuzzyScore(state.query, cell.dataset.q) < 0);
  });
  bar.appendChild(search);
  host.appendChild(bar);

  panes.forEach((pane) => {
    if (pane.caption) {
      const cap = document.createElement("div");
      cap.className = "pane-cap";
      cap.textContent = pane.caption;
      host.appendChild(cap);
    }
    host.appendChild(renderPane(pane, state, rerender));
  });
  return host;
}

// container list in the raw tree -> inventory editor in a modal
function openInventoryModal(label, node, style) {
  const shell = modalShell(label, true);
  const state = { rootKey: label, stack: [], query: "" };
  const rerender = () => {
    shell.body.textContent = "";
    shell.body.appendChild(renderInventoryBrowser(
      [{ key: label, label, node, style }], state, rerender));
  };
  rerender();
}

// ------------------------------------------------------- player view

const GAMEMODES = ["survival", "creative", "adventure", "spectator"];

function viewTabs(modes) {
  const bar = document.createElement("div");
  bar.className = "view-tabs";
  for (const [id, label] of modes) {
    const t = document.createElement("div");
    t.className = "view-tab" + (viewMode === id ? " active" : "");
    t.textContent = label;
    t.addEventListener("click", () => { viewMode = id; renderEditor(); });
    bar.appendChild(t);
  }
  return bar;
}

function playerFileTabs(ctx) {
  const bar = document.createElement("div");
  bar.className = "file-tabs";
  const who = document.createElement("span");
  who.className = "pv-label";
  who.textContent = ctx.player.label;
  bar.appendChild(who);
  for (const f of ctx.player.files.filter(f => !f.label.includes("(old)"))) {
    const chip = document.createElement("button");
    chip.className = "pv-chip" + (f.path === file.path ? " on" : "");
    chip.textContent = f.label;
    chip.title = f.path;
    chip.addEventListener("click", () => {
      if (f.path !== file.path)
        openFile(f.path, `${ctx.server.name} / ${ctx.player.label} / ${f.label}`);
    });
    bar.appendChild(chip);
  }
  return bar;
}

function maxHealth() {
  for (const [listKey, idKey, valKey] of [["attributes", "id", "base"],
                                          ["Attributes", "Name", "Base"]]) {
    const list = tpath(file.root, listKey);
    if (list && list.t === "list")
      for (const a of list.v) {
        if (a.t !== "compound") continue;
        const id = a.v[idKey] ? String(a.v[idKey].v) : "";
        if (/max_health|maxHealth/i.test(id) && a.v[valKey])
          return Number(a.v[valKey].v);
      }
  }
  return 20;
}

function vitalsCard() {
  const r = file.root;
  const c = card("vitals");
  const health = frow(c.body, "health");
  addNum(health, tpath(r, "Health"), "num");
  const max = document.createElement("span");
  max.className = "pv-label";
  max.textContent = "/ " + maxHealth();
  health.appendChild(max);
  numRow(c.body, "food", tpath(r, "foodLevel"), "num");
  numRow(c.body, "saturation", tpath(r, "foodSaturationLevel"), "num");
  numRow(c.body, "air", tpath(r, "Air"), "num");
  numRow(c.body, "fire", tpath(r, "Fire"), "num");
  numRow(c.body, "absorption", tpath(r, "AbsorptionAmount"), "num");
  const gm = tpath(r, "playerGameType");
  if (gm) {
    const ctls = frow(c.body, "gamemode");
    const sel = document.createElement("select");
    sel.className = "pv-select";
    GAMEMODES.forEach((g, i) => {
      const o = document.createElement("option");
      o.value = i;
      o.textContent = g;
      sel.appendChild(o);
    });
    if (gm.v < 0 || gm.v > 3) {
      const o = document.createElement("option");
      o.value = gm.v;
      o.textContent = "mode " + gm.v;
      sel.appendChild(o);
    }
    sel.value = gm.v;
    sel.addEventListener("change", () => { gm.v = Number(sel.value); setDirty(true); });
    ctls.appendChild(sel);
  }
  return c;
}

// X/Y/Z (or any coord triple) stacked in one column under a single label
function coordColumn(body, label, nodes) {
  const f = document.createElement("div");
  f.className = "field";
  const l = document.createElement("span");
  l.className = "field-label";
  l.textContent = label;
  f.appendChild(l);
  for (const n of nodes) if (n && !CONTAINERS.has(n.t)) f.appendChild(boundInput(n));
  body.appendChild(f);
}

function positionCard() {
  const r = file.root;
  const c = card("position");
  const p = tpath(r, "Pos");
  if (p && p.t === "list" && p.v.length === 3)
    coordColumn(c.body, "position", p.v);
  const rot = tpath(r, "Rotation");
  if (rot && rot.t === "list" && rot.v.length === 2) {
    const ctls = frow(c.body, "angle");
    for (const n of rot.v) addNum(ctls, n, "coord");
  }
  numRow(c.body, "dimension", tpath(r, "Dimension"), "wide");
  return c;
}

function spawnCard() {
  const r = file.root;
  const sx = tpath(r, "SpawnX"), sy = tpath(r, "SpawnY"), sz = tpath(r, "SpawnZ");
  if (!sx && !sy && !sz) return null;
  const c = card("spawnpoint");
  coordColumn(c.body, "position", [sx, sy, sz]);
  numRow(c.body, "dimension", tpath(r, "SpawnDimension"), "wide");
  return c;
}

function experienceCard() {
  const r = file.root;
  const c = card("experience");
  numRow(c.body, "level", tpath(r, "XpLevel"), "num");
  const prog = tpath(r, "XpP");
  if (prog) {
    const ctls = frow(c.body, "progress");
    const pct = document.createElement("span");
    pct.className = "pv-label msl-pct";
    const upd = (v) => { pct.textContent = Math.round(v * 100) + "%"; };
    const sl = miniSlider(0, 1, Number(prog.v), 0.01, (v) => {
      prog.v = Math.round(v * 1000) / 1000;
      upd(v);
      setDirty(true);
    });
    upd(Number(prog.v));
    ctls.appendChild(sl.el);
    ctls.appendChild(pct);
  }
  numRow(c.body, "total", tpath(r, "XpTotal"), "num");
  numRow(c.body, "score", tpath(r, "Score"), "num");
  return c;
}

function abilitiesCard() {
  const r = file.root;
  const c = card("abilities");
  switchRow(c.body, "invulnerable", tpath(r, "abilities.invulnerable"));
  switchRow(c.body, "may fly", tpath(r, "abilities.mayfly"));
  switchRow(c.body, "flying", tpath(r, "abilities.flying"));
  switchRow(c.body, "instabuild", tpath(r, "abilities.instabuild"));
  switchRow(c.body, "may build", tpath(r, "abilities.mayBuild"));
  numRow(c.body, "walk speed", tpath(r, "abilities.walkSpeed"), "num");
  numRow(c.body, "fly speed", tpath(r, "abilities.flySpeed"), "num");
  return c;
}

function effectsList() {
  let list = tpath(file.root, "active_effects");
  let modern = true;
  if (!list) {
    list = tpath(file.root, "ActiveEffects");
    if (list) modern = false;
    else modern = dataVersion() >= 3578;
  }
  return { list, modern };
}

async function loadEffectIds() {
  const server = fileServer();
  if (!server || effectIdsLoaded === server) return;
  let mod = [];
  try { mod = (await api("/api/effects?server=" + encodeURIComponent(server))).effects; }
  catch { /* mods dir may not exist */ }
  const all = [...new Set([...VANILLA_EFFECTS, ...mod])].sort();
  effectIds = all;
  const dl = $("effect-ids");
  dl.textContent = "";
  for (const id of all) {
    const o = document.createElement("option");
    o.value = id;
    dl.appendChild(o);
  }
  effectIdsLoaded = server;
}

async function loadItemIds() {
  const server = fileServer();
  if (!server || itemIdsLoaded === server) return;
  let mod = [];
  try { mod = (await api("/api/items?server=" + encodeURIComponent(server))).items; }
  catch { /* mods dir may not exist — vanilla ids still populate the list */ }
  itemIds = [...new Set([...VANILLA_ITEMS, ...mod])].sort();
  itemIdsLoaded = server;
}

// Styled autocomplete for any game-ID field (a native <datalist> can't be
// themed). Filters options as you type, highlights the best match first, arrow
// keys move the highlight, Enter/click commits it. With `iconKind` set it shows
// a live icon of the current first match to the left of the box.
// opts: { options[], placeholder, initial, iconKind ("item"|"effect"|null),
//         onEnter (menu-closed Enter → submit form), onChange (value changed) }
// Returns { el, input, value() }.
function comboBox({ options = [], placeholder = "", initial = "",
                    iconKind = null, onEnter = null, onChange = null } = {}) {
  const wrap = document.createElement("div");
  wrap.className = "combo";
  const field = document.createElement("div");
  field.className = "combo-field";
  let iconHolder = null;
  if (iconKind) {
    iconHolder = document.createElement("span");
    iconHolder.className = "combo-icon";
    field.appendChild(iconHolder);
  }
  const input = document.createElement("input");
  input.type = "text";
  input.className = "pv-input wide";
  input.placeholder = placeholder || "";
  input.autocomplete = "off";
  if (initial) input.value = initial;
  field.appendChild(input);
  wrap.appendChild(field);
  const menu = document.createElement("div");
  menu.className = "combo-menu";
  menu.hidden = true;
  wrap.appendChild(menu);

  let matches = [];
  let sel = -1;
  let lastIcon = null;

  const previewId = () => (sel >= 0 && matches[sel]) ? matches[sel] : input.value.trim();
  const updateIcon = () => {
    if (!iconHolder) return;
    const raw = previewId();
    if (raw === lastIcon) return;   // avoid re-fetching the same icon per keystroke
    lastIcon = raw;
    iconHolder.textContent = "";
    if (raw) iconHolder.appendChild(
      iconBox(raw.includes(":") ? raw : "minecraft:" + raw, iconKind, "combo-ic"));
  };
  const rebuild = () => {
    const q = input.value.trim().toLowerCase();
    let pool = q ? options.filter((o) => o.toLowerCase().includes(q)) : options.slice();
    if (q) pool.sort((a, b) =>
      (a.toLowerCase().startsWith(q) ? 0 : 1) - (b.toLowerCase().startsWith(q) ? 0 : 1));
    matches = pool.slice(0, 60);
    sel = matches.length ? 0 : -1;   // first match is the default pick
    paint();
  };
  const paint = () => {
    menu.textContent = "";
    updateIcon();
    if (!matches.length) { menu.hidden = true; return; }
    menu.hidden = false;
    matches.forEach((m, i) => {
      const row = document.createElement("div");
      row.className = "combo-row" + (i === sel ? " sel" : "");
      row.textContent = m;
      row.addEventListener("mousedown", (ev) => { ev.preventDefault(); commit(m); });
      menu.appendChild(row);
    });
    const cur = menu.children[sel];
    if (cur) cur.scrollIntoView({ block: "nearest" });
  };
  const commit = (val) => {
    input.value = val; matches = []; sel = -1; menu.hidden = true;
    updateIcon();
    if (onChange) onChange(val);
  };

  input.addEventListener("input", () => { rebuild(); if (onChange) onChange(input.value); });
  input.addEventListener("focus", rebuild);
  input.addEventListener("blur", () => setTimeout(() => { menu.hidden = true; }, 120));
  input.addEventListener("keydown", (ev) => {
    if (ev.key === "ArrowDown" && matches.length) {
      ev.preventDefault(); sel = (sel + 1) % matches.length; paint();
    } else if (ev.key === "ArrowUp" && matches.length) {
      ev.preventDefault(); sel = (sel - 1 + matches.length) % matches.length; paint();
    } else if (ev.key === "Enter") {
      if (!menu.hidden && sel >= 0) { ev.preventDefault(); commit(matches[sel]); }
      else if (onEnter) { ev.preventDefault(); onEnter(); }
    } else if (ev.key === "Escape" && !menu.hidden) {
      ev.stopPropagation(); menu.hidden = true;
    }
  });

  updateIcon();
  return { el: wrap, input, value: () => input.value };
}

function openEffectModal() {
  const { modern } = effectsList();
  const shell = modalShell("add effect");
  const b = shell.body;

  const submit = () => {
    try {
      const a = validateScalar("byte", amp.value);
      let d = validateScalar("int", dur.value);
      if (d > DURATION_MAX) d = DURATION_MAX;   // game engine's hard cap
      let target = effectsList().list;
      if (!target) {
        const key = modern ? "active_effects" : "ActiveEffects";
        file.root.v[key] = { t: "list", v: [] };
        target = file.root.v[key];
      }
      if (modern) {
        let id = combo.value().trim();
        if (!id) throw new Error("effect id required");
        if (!id.includes(":")) id = "minecraft:" + id;
        target.v.push({ t: "compound", v: {
          id: { t: "string", v: id },
          amplifier: { t: "byte", v: a },
          duration: { t: "int", v: d },
          ambient: { t: "byte", v: 0 },
          show_particles: { t: "byte", v: 1 },
          show_icon: { t: "byte", v: 1 },
        }});
      } else {
        const num = Number(combo.value().trim());
        if (!Number.isInteger(num)) throw new Error("this file uses numeric effect ids");
        target.v.push({ t: "compound", v: {
          Id: { t: "int", v: num },
          Amplifier: { t: "byte", v: a },
          Duration: { t: "int", v: d },
          Ambient: { t: "byte", v: 0 },
          ShowParticles: { t: "byte", v: 1 },
          ShowIcon: { t: "byte", v: 1 },
        }});
      }
      setDirty(true);
      shell.close();
      renderEditor();
    } catch (e) { setStatus(String(e.message || e), "err"); }
  };

  const idField = document.createElement("div");
  idField.className = "field";
  const idLabel = document.createElement("span");
  idLabel.className = "field-label";
  idLabel.textContent = "effect";
  idField.appendChild(idLabel);
  const combo = comboBox({
    options: modern ? effectIds : [],
    placeholder: modern ? "minecraft:speed" : "numeric id",
    initial: modern ? "" : "1",
    iconKind: modern ? "effect" : null,
    onEnter: submit,
  });
  idField.appendChild(combo.el);
  b.appendChild(idField);

  // amplifier + duration side by side, labels stacked above each input
  const row = document.createElement("div");
  row.className = "field-row";
  const ampField = document.createElement("div");
  ampField.className = "field";
  const ampLabel = document.createElement("span");
  ampLabel.className = "field-label";
  ampLabel.textContent = "amplifier";
  const amp = document.createElement("input");
  amp.type = "text";
  amp.className = "pv-input";
  amp.value = "0";
  ampField.appendChild(ampLabel);
  ampField.appendChild(amp);
  const durField = document.createElement("div");
  durField.className = "field";
  const durLabel = document.createElement("span");
  durLabel.className = "field-label";
  durLabel.textContent = "duration";
  const dur = document.createElement("input");
  dur.type = "text";
  dur.className = "pv-input";
  dur.value = "1200";
  dur.setAttribute("max", String(DURATION_MAX));
  durField.appendChild(durLabel);
  durField.appendChild(dur);
  row.appendChild(ampField);
  row.appendChild(durField);
  b.appendChild(row);

  for (const inp of [amp, dur])
    inp.addEventListener("keydown", (ev) => { if (ev.key === "Enter") { ev.preventDefault(); submit(); } });

  const foot = document.createElement("div");
  foot.className = "modal-foot";
  const spacer = document.createElement("span");
  spacer.className = "spacer";
  foot.appendChild(spacer);
  const cancel = document.createElement("button");
  cancel.className = "btn";
  cancel.textContent = "cancel";
  cancel.addEventListener("click", shell.close);
  foot.appendChild(cancel);
  const add = document.createElement("button");
  add.className = "btn primary";
  add.textContent = "add";
  add.addEventListener("click", submit);
  foot.appendChild(add);
  b.appendChild(foot);
  combo.input.focus();
}

function effectsCard() {
  const { list, modern } = effectsList();
  const c = card("potion effects");
  c.classList.add("fx-card");
  const addBtn = document.createElement("button");
  addBtn.className = "fx-add";
  addBtn.textContent = "+";
  addBtn.title = "add effect";
  addBtn.addEventListener("click", openEffectModal);
  c.appendChild(addBtn);
  const wrap = document.createElement("div");
  wrap.className = "effect-cards";
  c.body.appendChild(wrap);

  const K = modern
    ? { id: "id", amp: "amplifier", dur: "duration" }
    : { id: "Id", amp: "Amplifier", dur: "Duration" };

  (list ? list.v : []).forEach((eff, i) => {
    if (eff.t !== "compound") return;
    const ec = document.createElement("div");
    ec.className = "effect-card";
    const del = document.createElement("button");
    del.className = "mini-btn del fx-close";
    del.textContent = "×";
    del.addEventListener("click", () => {
      list.v.splice(i, 1);
      setDirty(true);
      renderEditor();
    });
    ec.appendChild(del);

    const head = document.createElement("div");
    head.className = "fx-head";
    const idNode = eff.v[K.id];
    if (idNode && idNode.t === "string")
      head.appendChild(iconBox(String(idNode.v), "effect"));
    if (idNode) {
      const idInput = boundInput(idNode, "wide");
      if (idNode.t === "string") idInput.setAttribute("list", "effect-ids");
      head.appendChild(idInput);
    }
    ec.appendChild(head);

    // amplifier (a.k.a. potency) and duration are omitted from the NBT when
    // they're 0 — materialise a default so the box always shows and is editable.
    const ampNode = eff.v[K.amp] || (eff.v[K.amp] = { t: "byte", v: 0 });
    const durNode = eff.v[K.dur] || (eff.v[K.dur] = { t: "int", v: 0 });
    // labels stacked above their boxes; both flex-fill the row width
    const rowEl = document.createElement("div");
    rowEl.className = "field-row";
    const stacked = (labelText, node) => {
      const f = document.createElement("div");
      f.className = "field";
      const l = document.createElement("span");
      l.className = "field-label";
      l.textContent = labelText;
      f.appendChild(l);
      f.appendChild(boundInput(node));
      return f;
    };
    rowEl.appendChild(stacked("amplifier", ampNode));
    rowEl.appendChild(stacked("duration", durNode));
    ec.appendChild(rowEl);
    wrap.appendChild(ec);
  });

  return c;
}

function itemsCard() {
  const c = card("items", true);
  const host = document.createElement("div");
  c.body.appendChild(host);
  const rerender = () => {
    host.textContent = "";
    host.appendChild(renderInventoryBrowser(discoverInventories(), invState, rerender));
  };
  rerender();
  return c;
}

function renderPlayerView() {
  // One responsive grid (see .pv-layout): Inventory spans the full width on
  // top, then the remaining panes pair up 2-up on wide screens and collapse
  // to a single interleaved column when narrow. DOM order below IS the
  // narrow-column order, and also lays out the wide pairs row by row:
  //   Inventory (full)
  //   Position       | Spawnpoint
  //   Potion Effects | Experience
  //   Vitals         | Abilities
  // (Spawnpoint and Experience are deliberately swapped out of their old
  // sidebar positions so these pairs line up.)
  const layout = document.createElement("div");
  layout.className = "pv-layout";
  // Panes that carried the old .pv-side form tweaks keep them via .pv-pane.
  const pane = (c) => { if (c) c.classList.add("pv-pane"); return c; };

  layout.appendChild(itemsCard());        // Inventory — full width, top
  layout.appendChild(pane(positionCard()));
  const sp = spawnCard();
  if (sp) layout.appendChild(pane(sp));    // Spawnpoint
  layout.appendChild(effectsCard());      // Potion Effects
  layout.appendChild(pane(experienceCard()));
  layout.appendChild(pane(vitalsCard()));
  layout.appendChild(pane(abilitiesCard()));
  return layout;
}

// -------------------------------------------------------- storage view
//
// The blanket view: every stack (item or fluid) in the file, grouped by its
// container, editable in place. Works for any file — playerdata, ender-chest
// frequency saves, shared-tank saves, backpack saves — with no per-mod code.

function renderStackRow(s, rerender) {
  const row = document.createElement("div");
  row.className = "stack-row";
  const idNode = s.node.v[s.idKey];
  const combo = comboBox({
    options: s.kind === "item" ? itemIds : [],
    initial: String(idNode.v),
    iconKind: s.kind === "item" ? "item" : null,
    onChange: (v) => {
      idNode.v = (v.includes(":") || !v) ? v : "minecraft:" + v;
      setDirty(true);
    },
  });
  row.appendChild(combo.el);
  if (s.qtyKey) {
    const qty = boundInput(s.node.v[s.qtyKey], "num");
    row.appendChild(qty);
  }
  if (s.owner) {
    const del = document.createElement("button");
    del.className = "mini-btn del";
    del.textContent = "×";
    del.title = "remove this slot";
    del.addEventListener("click", () => {
      s.owner.list.v.splice(s.owner.index, 1);
      setDirty(true);
      rerender();
    });
    row.appendChild(del);
  }
  return row;
}

function renderStorageView() {
  const wrap = document.createElement("div");
  wrap.className = "pv-main";
  const render = () => {
    wrap.textContent = "";
    const groups = storageGroups(file.root);
    if (!groups.size) {
      const d = document.createElement("div");
      d.className = "dim";
      d.textContent = "No stored items or fluids found in this file.";
      wrap.appendChild(d);
      return;
    }
    for (const [, g] of groups) {
      const c = card(g.label, false);
      for (const s of g.stacks) c.body.appendChild(renderStackRow(s, render));
      wrap.appendChild(c);
    }
  };
  render();
  return wrap;
}

// -------------------------------------------------------- server view
//
// Clicking a server in the sidebar shows a grid of player cards (3D
// spinning skins via skinview3d, falling back to a flat body render, then
// to an initial avatar) plus the server's world files as large buttons.

let skinLibPromise = null;

function loadSkinLib() {
  if (!skinLibPromise)
    skinLibPromise = new Promise((resolve) => {
      const s = document.createElement("script");
      s.src = "https://unpkg.com/skinview3d@3.4.1/bundles/skinview3d.bundle.js";
      s.onload = () => resolve(true);
      s.onerror = () => resolve(false);
      document.head.appendChild(s);
    });
  return skinLibPromise;
}

const MAX_3D_SKINS = 12; // browsers cap live WebGL contexts

function skinBox(player, idx) {
  const box = document.createElement("div");
  box.className = "skin-box";
  const fallback = document.createElement("div");
  fallback.className = "skin-fallback";
  fallback.textContent = (player.label[0] || "?").toUpperCase();
  box.appendChild(fallback);

  // Minecraft playerdata files are named with dashed UUIDs; skin services want
  // the trimmed (undashed) form — the dashed form makes some of them 404 or
  // fall back to the default Alex/Steve. mc-heads.net serves both the 3D
  // texture and the flat body (one reliable, CORS-enabled origin); crafatar.com
  // was previously the 3D source but is frequently unreachable/deprecated.
  const uuid = String(player.uuid).replace(/-/g, "");
  const skinUrl = `https://mc-heads.net/skin/${uuid}`;

  const flat = () => {
    const img = document.createElement("img");
    img.src = `https://mc-heads.net/body/${uuid}/120`;
    img.alt = "";
    img.onload = () => { fallback.remove(); };
    img.onerror = () => img.remove();
    box.appendChild(img);
  };

  if (idx >= MAX_3D_SKINS) { flat(); return box; }
  loadSkinLib().then((ok) => {
    if (!ok || !window.skinview3d) { flat(); return; }
    try {
      const canvas = document.createElement("canvas");
      const viewer = new skinview3d.SkinViewer({
        canvas, width: 120, height: 160,
        skin: skinUrl,
      });
      viewer.autoRotate = true;
      viewer.zoom = 0.9;
      viewer.loadSkin(skinUrl).then(
        () => { fallback.remove(); box.appendChild(canvas); },
        () => { viewer.dispose(); flat(); });
    } catch { flat(); }
  });
  return box;
}

function openServerView(s) {
  if (dirty && !confirm("Discard unsaved changes?")) return;
  file = null;
  currentServer = s;
  setDirty(false);
  closeTagSearch();
  $("tagsearch").hidden = true;
  $("filter").hidden = true;
  $("backup").disabled = true;
  $("restore").disabled = true;
  $("reload").disabled = true;
  setFilelabel(s.name);
  history.replaceState(null, "", "#server=" + encodeURIComponent(s.name));
  if (activeRow) { activeRow.classList.remove("active"); activeRow = null; }
  setStatus(null);
  renderEditor();
  collapseSidebar();
}

// Lay a wrapped set of equal-width items into balanced rows: pick the most
// columns that fit the container, then trim that back so the items spread
// evenly across the *same* number of rows — 5 items in a 4-wide space become
// 3+2, never 4+1. Re-runs on resize. Used for every uniform card/tile grid.
function balancedGrid(el, itemPx, gap = 14) {
  el.style.display = "grid";
  el.style.justifyContent = "center";
  const relayout = () => {
    const n = el.children.length;
    const w = el.clientWidth;
    if (!n || !w) return;
    const maxCols = Math.max(1, Math.floor((w + gap) / (itemPx + gap)));
    const rows = Math.ceil(n / maxCols);
    const cols = Math.ceil(n / rows);
    el.style.gap = gap + "px";
    el.style.gridTemplateColumns = `repeat(${cols}, ${itemPx}px)`;
  };
  relayout();
  new ResizeObserver(relayout).observe(el);
}

function renderServerView(s) {
  const wrap = document.createElement("div");
  wrap.className = "server-view";

  const players = document.createElement("div");
  players.className = "sv-players";
  (s.players || []).forEach((p, i) => {
    const cardEl = document.createElement("div");
    cardEl.className = "p-card";
    cardEl.appendChild(skinBox(p, i));
    const name = document.createElement("div");
    name.className = "p-name";
    name.textContent = p.label;
    cardEl.appendChild(name);
    cardEl.addEventListener("click", () =>
      openFile(p.files[0].path, `${s.name} / ${p.label} / ${p.files[0].label}`));
    players.appendChild(cardEl);
  });
  wrap.appendChild(players);
  if (s.players && s.players.length) balancedGrid(players, 152);

  // Group world files by their full relative directory path — flat, one card
  // per directory, no nesting. The label base is the world's data dir, so a
  // file at <world>/data/ImmersiveEngineering/MyData/foo.dat lands in a single
  // group "ImmersiveEngineering/MyData". Files at a world root (level.dat) or
  // sitting directly in data/ keep the old behavior: grouped under the world.
  const groups = new Map();          // dir label -> [{ label, path, title }]
  const allPaths = [];
  const add = (key, e) => {
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
    allPaths.push(e.path);
  };
  for (const w of s.worlds) {
    const dataDir = w.level.replace(/\/level\.dat$/, "") + "/data/";
    add(w.name, { label: "level.dat", path: w.level,
                  title: `${s.name} / ${w.name}` });
    for (const d of w.data) {
      const fileDir = d.path.slice(0, d.path.lastIndexOf("/") + 1);
      const key = fileDir.startsWith(dataDir) && fileDir.length > dataDir.length
        ? fileDir.slice(dataDir.length, -1) : w.name;
      add(key, { label: d.label, path: d.path,
                 title: `${s.name} / ${w.name} / ${d.label}` });
    }
  }

  const files = document.createElement("div");
  files.className = "sv-files";
  const title = document.createElement("div");
  title.className = "card-title";
  title.textContent = "files";
  files.appendChild(title);
  // Reuse the effect-cards flex-fill grid: .effect-cards wraps a row of
  // .effect-card (flex: 1 1 250px) so cards grow to keep rows balanced.
  const cards = document.createElement("div");
  cards.className = "effect-cards";
  for (const [key, group] of groups) {
    const card = document.createElement("div");
    card.className = "effect-card";
    const ct = document.createElement("div");
    ct.className = "card-title";
    ct.textContent = key;
    card.appendChild(ct);
    const list = document.createElement("div");
    list.className = "sv-file-list";
    for (const e of group) {
      const b = document.createElement("button");
      b.className = "sv-file";
      b.textContent = e.label;
      b.addEventListener("click", () => openFile(e.path, e.title));
      list.appendChild(b);
    }
    card.appendChild(list);
    cards.appendChild(card);
  }
  files.appendChild(cards);
  wrap.appendChild(files);

  // Warm the cache for everything reachable from this screen so the first
  // click opens instantly instead of parsing on demand.
  prefetchFiles([...(s.players || []).map((p) => p.files[0].path),
                 ...allPaths]);
  return wrap;
}

// ------------------------------------------------------ tag path search

function collectPaths() {
  if (file._paths) return file._paths;
  const out = [];
  (function walk(n, label) {
    if (out.length > 100000) return;
    if (n.t === "compound") {
      for (const k of Object.keys(n.v)) walk(n.v[k], label ? label + " / " + k : k);
    } else if (n.t === "list") {
      if (n.v.length <= 1000) n.v.forEach((c, i) => walk(c, label + " / " + i));
    } else if (!CONTAINERS.has(n.t)) {
      out.push({ label, node: n });
    }
  })(file.root, "");
  file._paths = out;
  return out;
}

function closeTagSearch() {
  $("tagresults").hidden = true;
  tagMatches = [];
  tagSel = -1;
}

function renderTagResults() {
  const box = $("tagresults");
  box.textContent = "";
  if (!tagMatches.length) { box.hidden = true; return; }
  box.hidden = false;
  tagMatches.forEach((m, i) => {
    const row = document.createElement("div");
    row.className = "tag-row" + (i === tagSel ? " sel" : "");
    const pathEl = document.createElement("span");
    pathEl.className = "tag-path";
    pathEl.textContent = m.label;
    row.appendChild(pathEl);
    const val = document.createElement("span");
    val.className = "tag-val";
    val.textContent = String(m.node.v);
    row.appendChild(val);
    const type = document.createElement("span");
    type.className = "nbt-type";
    type.textContent = m.node.t;
    row.appendChild(type);
    row.addEventListener("click", () => { tagSel = i; editTagRow(); });
    box.appendChild(row);
  });
}

function editTagRow() {
  const box = $("tagresults");
  const row = box.children[tagSel];
  const m = tagMatches[tagSel];
  if (!row || !m) return;
  const val = row.querySelector(".tag-val");
  const input = document.createElement("input");
  input.className = "nbt-edit";
  input.value = String(m.node.v);
  val.replaceWith(input);
  input.focus();
  input.select();
  let done = false;
  const finish = (apply) => {
    if (done) return;
    done = true;
    if (apply) {
      try {
        m.node.v = validateScalar(m.node.t, input.value);
        setDirty(true);
        setStatus("set " + m.label + " = " + m.node.v, "ok");
        closeTagSearch();
        $("tagsearch").value = "";
        renderEditor();
        return;
      } catch (e) { setStatus(String(e.message || e), "err"); }
    }
    renderTagResults();
    $("tagsearch").focus();
  };
  input.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") { ev.stopPropagation(); finish(true); }
    if (ev.key === "Escape") { ev.stopPropagation(); finish(false); }
  });
  input.addEventListener("blur", () => finish(false));
}

function onTagSearchInput() {
  if (!file) return;
  const q = $("tagsearch").value.trim();
  if (!q) { closeTagSearch(); return; }
  tagMatches = collectPaths()
    .map((e) => ({ ...e, score: fuzzyScore(q, e.label) }))
    .filter((e) => e.score >= 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 30);
  tagSel = tagMatches.length ? 0 : -1;
  renderTagResults();
}

// ------------------------------------------------------- servers landing

// Status has no live source (we don't ping), so it's fetched from
// /api/servers/status and refreshed by a 30s poll that runs ONLY while this
// pane is on screen — renderEditor() stops the poll on every other view.
let serversStatus = {};        // name -> { online, players, maxPlayers, lastActive }
let serversPollTimer = null;

function stopServersPoll() {
  if (serversPollTimer) { clearInterval(serversPollTimer); serversPollTimer = null; }
}

function relTimeAgo(epoch) {
  if (!epoch) return "unknown";
  const s = Math.max(0, Math.floor(Date.now() / 1000) - epoch);
  for (const [secs, name] of [[86400, "day"], [3600, "hour"], [60, "minute"]]) {
    if (s >= secs) { const n = Math.floor(s / secs); return `${n} ${name}${n === 1 ? "" : "s"} ago`; }
  }
  return "just now";
}

function serverStatusPill(st) {
  const pill = document.createElement("span");
  const online = !!(st && st.online);
  pill.className = "s-status " + (online ? "online" : "offline");
  pill.textContent = online ? "online" : "offline";
  return pill;
}

async function refreshServersStatus(cards) {
  let list;
  try { list = await api("/api/servers/status"); }
  catch { return; }   // keep the last-known state on a failed poll
  serversStatus = {};
  for (const st of list) serversStatus[st.name] = st;
  for (const c of cards) c.update(serversStatus[c.name]);
}

// The default pane: a card per server (reusing the .p-card look + balancedGrid).
function renderServersLanding() {
  const grid = document.createElement("div");
  grid.className = "sv-servers";
  const cards = [];
  for (const s of tree.servers) {
    const card = document.createElement("div");
    card.className = "p-card";

    // server-icon.png, falling back to an initial-letter tile (mirrors skinBox).
    const iconWrap = document.createElement("div");
    iconWrap.className = "skin-box s-icon";
    const fallback = document.createElement("div");
    fallback.className = "skin-fallback";
    fallback.textContent = (s.name[0] || "?").toUpperCase();
    iconWrap.appendChild(fallback);
    const img = document.createElement("img");
    img.src = "/api/server-icon?server=" + encodeURIComponent(s.name);
    img.alt = "";
    img.onload = () => { fallback.remove(); };
    img.onerror = () => img.remove();
    iconWrap.appendChild(img);
    card.appendChild(iconWrap);

    const name = document.createElement("div");
    name.className = "p-name";
    name.textContent = s.name;
    card.appendChild(name);

    const meta = document.createElement("div");
    meta.className = "s-meta";
    card.appendChild(meta);

    const count = document.createElement("div");
    count.className = "s-players";
    card.appendChild(count);

    const footer = document.createElement("div");
    footer.className = "s-footer";
    card.appendChild(footer);

    const update = (st) => {
      meta.textContent = "";
      meta.appendChild(serverStatusPill(st));
      const n = st ? st.players : 0;
      const mx = st && st.maxPlayers != null ? st.maxPlayers : null;
      count.textContent = mx != null ? `${n} player${n === 1 ? "" : "s"} · ${mx} max` : `${n} player${n === 1 ? "" : "s"}`;
      if (st && !st.online && st.lastActive) {
        footer.textContent = "last booted " + relTimeAgo(st.lastActive);
        footer.hidden = false;
      } else {
        footer.textContent = "";
        footer.hidden = true;
      }
    };
    update(serversStatus[s.name]);   // paint from any cached status at once

    card.addEventListener("click", () => openServerView(s));
    grid.appendChild(card);
    cards.push({ name: s.name, update });
  }

  balancedGrid(grid, 176);

  stopServersPoll();
  refreshServersStatus(cards);
  serversPollTimer = setInterval(() => {
    if (!document.body.contains(grid)) { stopServersPoll(); return; }
    refreshServersStatus(cards);
  }, 30000);

  return grid;
}

// --------------------------------------------------------------- editor

function renderEditor() {
  const el = $("editor");
  el.textContent = "";
  stopServersPoll();
  if (!file) {
    if (currentServer) {
      el.appendChild(renderServerView(currentServer));
      return;
    }
    el.appendChild(renderServersLanding());
    return;
  }
  const ctx = playerCtx(file.path);
  if (ctx && ctx.player.files.length > 1) el.appendChild(playerFileTabs(ctx));
  const player = isPlayerFile(file);
  const hasStorage = !player && findStacks(file.root).length > 0;
  const modes = [];
  if (player) modes.push(["player", "player"]);
  if (hasStorage) modes.push(["storage", "storage"]);
  modes.push(["raw", "raw nbt"]);
  if (!modes.some((m) => m[0] === viewMode)) viewMode = modes[0][0];
  $("filter").hidden = viewMode !== "raw";
  if (modes.length > 1) el.appendChild(viewTabs(modes));
  if (viewMode === "player") { el.appendChild(renderPlayerView()); return; }
  if (viewMode === "storage") { el.appendChild(renderStorageView()); return; }
  const q = $("filter").value.trim().toLowerCase();
  el.appendChild(renderNode(file.root, file.rootName || "(root)", "$", null, q));
}

// ----------------------------------------------------------------- I/O

async function api(url, opts) {
  const res = await fetch(url, opts);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || res.statusText);
  return body;
}

// Warm the server's parse cache for files the user is likely to open next
// (everything linked from the screen they just loaded), so the first click is
// instant. Best-effort and low-priority: each path is fetched once ever, a few
// at a time, and failures are ignored.
const prefetched = new Set();
async function prefetchFiles(paths) {
  const queue = [...new Set(paths)].filter((p) => p && !prefetched.has(p));
  queue.forEach((p) => prefetched.add(p));
  const CONCURRENCY = 4;
  const worker = async () => {
    while (queue.length) {
      const p = queue.shift();
      try { await fetch("/api/prefetch?path=" + encodeURIComponent(p)); }
      catch { prefetched.delete(p); }
    }
  };
  for (let i = 0; i < CONCURRENCY; i++) worker();
}

async function openFile(path, label, row) {
  if (dirty && !confirm("Discard unsaved changes?")) return;
  try {
    setStatus("loading…");
    file = await api("/api/file?path=" + encodeURIComponent(path));
    currentServer = null;
    expanded.clear();
    expanded.add("$");
    viewMode = isPlayerFile(file) ? "player"
      : (findStacks(file.root).length ? "storage" : "raw");
    invState.rootKey = null;
    invState.stack = [];
    invState.query = "";
    closeTagSearch();
    $("tagsearch").value = "";
    $("tagsearch").hidden = false;
    setDirty(false);
    setStatus(null);
    setFilelabel(label || path);
    history.replaceState(null, "", "#path=" + encodeURIComponent(path));
    $("filter").hidden = false;
    $("reload").disabled = false;
    $("backup").disabled = false;
    $("restore").disabled = false;
    $("restoremenu").hidden = true;
    if (activeRow) activeRow.classList.remove("active");
    if (!row) row = $("tree").querySelector(`[data-path="${CSS.escape(path)}"]`) || undefined;
    if (row) { row.classList.add("active"); activeRow = row; }
    loadEffectIds();
    loadItemIds();
    renderEditor();
    collapseSidebar();
  } catch (e) {
    setStatus("open failed: " + e.message, "err");
  }
}

async function saveFile() {
  if (!file || !dirty) return;
  try {
    setStatus("saving…");
    const r = await api("/api/file?path=" + encodeURIComponent(file.path), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ root: file.root }),
    });
    setDirty(false);
    setStatus("saved (backup: " + r.backup + ")", "ok");
  } catch (e) {
    setStatus("save failed: " + e.message, "err");
  }
}

async function reloadFile() {
  if (!file) return;
  if (dirty && !confirm("Discard unsaved changes and reload from disk?")) return;
  const path = file.path, label = $("filelabel").textContent;
  setDirty(false);
  await openFile(path, label, activeRow);
}

async function backupFile() {
  if (!file) return;
  try {
    const r = await api("/api/backup?path=" + encodeURIComponent(file.path), { method: "POST" });
    setStatus("backed up as " + r.name, "ok");
  } catch (e) {
    setStatus("backup failed: " + e.message, "err");
  }
}

async function toggleRestoreMenu() {
  const menu = $("restoremenu");
  if (!menu.hidden) { menu.hidden = true; return; }
  if (!file) return;
  try {
    const r = await api("/api/backups?path=" + encodeURIComponent(file.path));
    menu.textContent = "";
    if (!r.backups.length) {
      const d = document.createElement("div");
      d.className = "tag-path";
      d.style.padding = "6px 10px";
      d.textContent = "no backups yet";
      menu.appendChild(d);
    }
    for (const bkp of r.backups) {
      const row = document.createElement("div");
      row.className = "tag-row";
      const name = document.createElement("span");
      name.className = "tag-path";
      name.textContent = bkp.name;
      row.appendChild(name);
      const size = document.createElement("span");
      size.className = "tag-val";
      size.textContent = Math.max(1, Math.round(bkp.size / 1024)) + " KB";
      row.appendChild(size);
      row.addEventListener("click", async () => {
        menu.hidden = true;
        if (!confirm(`Restore ${bkp.name}? The current state is backed up first.`)) return;
        try {
          await api("/api/restore?path=" + encodeURIComponent(file.path) +
                    "&name=" + encodeURIComponent(bkp.name), { method: "POST" });
          setDirty(false);
          await openFile(file.path, $("filelabel").textContent, activeRow);
          setStatus("restored " + bkp.name, "ok");
        } catch (e) { setStatus("restore failed: " + e.message, "err"); }
      });
      menu.appendChild(row);
    }
    menu.hidden = false;
  } catch (e) {
    setStatus("could not list backups: " + e.message, "err");
  }
}

// --------------------------------------------------------------- breadcrumb

function navBreadcrumb(segs, idx) {
  if (!tree) return;
  const s = tree.servers.find((sv) => sv.name === segs[0]);
  if (!s) return;
  if (idx === 0) { openServerView(s); return; }
  const seg = segs[idx];
  const p = (s.players || []).find((pl) => pl.label === seg);
  if (p && p.files.length) {
    const pd = p.files[0];
    openFile(pd.path, `${s.name} / ${p.label} / ${pd.label}`);
    return;
  }
  const w = s.worlds.find((wr) => wr.name === seg);
  if (w) openFile(w.level, `${s.name} / ${w.name}`);
}

function setFilelabel(label) {
  const el = $("filelabel");
  el.textContent = "";
  el.classList.remove("dim");
  if (!label || !tree) { el.textContent = label || "no file open"; return; }
  const segs = label.split(" / ");
  segs.forEach((seg, i) => {
    if (i > 0) {
      const sep = document.createElement("span");
      sep.className = "crumb-sep";
      sep.textContent = " / ";
      el.appendChild(sep);
    }
    const isLast = (i === segs.length - 1);
    const btn = document.createElement("button");
    btn.className = "crumb" + (isLast ? " here" : "");
    btn.textContent = seg;
    btn.disabled = isLast;
    if (!isLast) btn.addEventListener("click", () => navBreadcrumb(segs, i));
    el.appendChild(btn);
  });
}

// ---------------------------------------------------------------- init

function collapseSidebar() {
  if (window.innerWidth <= 720) $("sidebar").classList.remove("open");
}

$("sidebar-toggle").addEventListener("click", () => {
  if (window.innerWidth > 720) $("sidebar").classList.toggle("collapsed");
  else $("sidebar").classList.toggle("open");
});
$("sidebar-backdrop").addEventListener("click", collapseSidebar);

$("search").addEventListener("input", renderSidebar);
$("filter").addEventListener("input", renderEditor);
$("save").addEventListener("click", saveFile);
$("reload").addEventListener("click", reloadFile);
$("backup").addEventListener("click", backupFile);
$("restore").addEventListener("click", toggleRestoreMenu);

$("tagsearch").addEventListener("input", onTagSearchInput);
$("tagsearch").addEventListener("keydown", (ev) => {
  if (ev.key === "ArrowDown") { ev.preventDefault(); if (tagSel < tagMatches.length - 1) { tagSel++; renderTagResults(); } }
  else if (ev.key === "ArrowUp") { ev.preventDefault(); if (tagSel > 0) { tagSel--; renderTagResults(); } }
  else if (ev.key === "Enter" && tagSel >= 0) { ev.preventDefault(); editTagRow(); }
  else if (ev.key === "Escape") { closeTagSearch(); $("tagsearch").blur(); }
});
document.addEventListener("click", (ev) => {
  if (!ev.target.closest("#tagresults") && ev.target !== $("tagsearch")) closeTagSearch();
  if (!ev.target.closest("#restoremenu") && ev.target !== $("restore")) $("restoremenu").hidden = true;
});

document.addEventListener("keydown", (ev) => {
  if ((ev.ctrlKey || ev.metaKey) && ev.key === "s") {
    ev.preventDefault();
    saveFile();
  }
});
window.addEventListener("beforeunload", (ev) => {
  if (dirty) ev.preventDefault();
});

(async () => {
  try {
    // The single-request page embeds the tree (see _index_page in server.py);
    // fall back to fetching it when served as plain static files.
    if (window.__NBT_TREE__) {
      tree = window.__NBT_TREE__;
    } else {
      setStatus("loading server tree…");
      tree = await api("/api/tree");
      setStatus(null);
    }
    for (const s of tree.servers) sbOpen.add(s.name);
    renderSidebar();
    const mp = location.hash.match(/^#path=(.+)$/);
    const ms = location.hash.match(/^#server=(.+)$/);
    if (mp) await openFile(decodeURIComponent(mp[1]));
    else if (ms) {
      const s = tree.servers.find((x) => x.name === decodeURIComponent(ms[1]));
      if (s) openServerView(s);
      else renderEditor();
    } else {
      renderEditor();
    }
  } catch (e) {
    setStatus("failed to load server tree: " + e.message, "err");
  }
})();
