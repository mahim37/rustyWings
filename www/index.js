import * as sim from "lib-simulation-wasm";
import { Terminal } from "./app/terminal";
import { Viewport } from "./app/viewport";

/* ---------- */

const terminal = new Terminal(
    document.getElementById("terminal-stdin"),
    document.getElementById("terminal-stdout"),
);

const viewport = new Viewport(
    document.getElementById("viewport"),
);

/**
 * Current simulation.
 *
 * @type {Simulation}
 */
let simulation = new sim.Simulation(sim.Simulation.default_config());

/**
 * Whether the simulation is working or not.
 * Can be modified by the `pause` command.
 *
 * @type {boolean}
 */
let active = true;

/* ---------- */

const config = simulation.config();
const printTerminal = (lines) => {
    lines.forEach(line => terminal.println(line));
};

printTerminal([
    "                _        __        ___                 ",
    " _ __ _   _ ___| |_ _   _\\ \\      / (_)_ __   __ _ ___ ",
    "| '__| | | / __| __| | | |\\ \\ /\\ / /| | '_ \\ / _` / __|",
    "| |  | |_| \\__ \\ |_| |_| | \\ V  V / | | | | | (_| \\__ \\",
    "|_|   \\__,_|___/\\__|\\__, |  \\_/\\_/  |_|_| |_|\\__, |___/",
    "                    |___/                    |___/     ",
    "",
    "            Simulation of Evolution",
    "Powered by Neural Networks and Genetic Algorithms,",
    "",
    "------------------ About -----------------",
    "",
    "Each triangle represents a bird. Every bird has:",
    "   1. An eye, whose field of vision is drawn around the bird",
    "   2. A brain that decides the bird's movement direction and speed",
    "",
    "Circles represent food, which birds aim to find and consume.",
    "",
    "The simulation begins with birds having randomized brains. After 2500 turns (about 40 seconds),",
    "the birds that consumed the most food are selected for reproduction. Their offspring then",
    "starts the next generation of the simulation.",
    "",
    "Through the genetic algorithm, each generation becomes slightly better at finding food -",
    "it's as if the birds are programming themselves!",
    "",
    "(Note: This is not the boids algorithm. Birds are not hard-coded to find food; they learn over time)",
    "",
    "--------------- Interaction ----------------",
    "",
    "You can influence the simulation by entering commands in the input box below.",
    "To start, try the `train` command a few times (type 't', press enter, repeat).",
    "This fast-forwards the simulation, allowing you to observe the birds' rapid learning.",
    "",
    "Want to explore the source code?",
    "https://github.com/mahim37/rustyWings",
    "",
    "Enjoy the simulation!",
    "",
    "---------------- Commands ------------------",
    "",
    "- p / pause",
    "  Pauses or resumes the simulation",
    "",
    `- r / reset [animals=${config.world_animals}] [f=${config.world_foods}] [...]`,
    "  Restarts the simulation with optional parameters:",
    "",
    `  * a / animals (default=${config.world_animals})`,
    "    Number of birds",
    "",
    `  * f / foods (default=${config.world_foods})`,
    "    Number of food items",
    "",
    `  * n / neurons (default=${config.brain_neurons})`,
    "    Number of brain neurons per bird",
    "",
    `  * p / photoreceptors (default=${config.eye_cells})`,
    "    Number of eye cells per bird",
    "",
    "  Examples:",
    "    reset animals=100 foods=100",
    "    r a=100 f=100",
    "    r p=3",
    "",
    "- (t)rain [generations]",
    "  Fast-forwards through one or more generations",
    "  Examples:",
    "    train",
    "    t 5",
    "",
    "---- Advanced Tips ----",
    "",
    "- The `reset` command can modify all parameters:",
    "",
    "  * r i:integer_param=123 f:float_param=123",
    "  * r a=200 f=200 f:food_size=0.002",
    "",
    "  (Note: Parameter names can be found in the source code)",
    "",
    "---- Interesting Scenarios ----",
    "",
    "  * r i:ga_reverse=1 f:sim_speed_min=0.003",
    "    (Birds avoid food)",
    "",
    "  * r i:brain_neurons=1",
    "    (Single-neuron 'zombie' birds)",
    "",
    "  * r f:food_size=0.05",
    "    (Larger food items)",
    "",
    "  * r f:eye_fov_angle=0.45",
    "    (Narrow field of view)",
    "",
    "----"
]);

terminal.scrollToTop();

const COMMANDS = {
    p: execPause,
    pause: execPause,
    r: execReset,
    reset: execReset,
    t: execTrain,
    train: execTrain
};

const CONFIG_PARSERS = {
    i: parseInt,
    f: parseFloat
};

const CONFIG_ALIASES = {
    a: 'world_animals',
    animals: 'world_animals',
    f: 'world_foods',
    foods: 'world_foods',
    n: 'brain_neurons',
    neurons: 'brain_neurons',
    p: 'eye_cells',
    photoreceptors: 'eye_cells'
};

terminal.onInput((input) => {
    terminal.println("");
    terminal.println(`$ ${input}`);

    try {
        exec(input);
    } catch (err) {
        terminal.println(`  ^ err: ${err}`);
    }
});

function exec(input) {
    if (input.includes("[") || input.includes("]")) {
        throw new Error("Square brackets are for documentation purposes - don't include them in commands, e.g.: reset animals=100");
    }

    const [cmd, ...args] = input.split(" ");
    const command = COMMANDS[cmd];

    if (!command) {
        throw new Error("Unknown command");
    }

    command(args);
}

function execPause(args) {
    if (args.length > 0) {
        throw new Error("This command accepts no parameters");
    }

    active = !active;
}

function execReset(args) {
    let config = sim.Simulation.default_config();

    for (const arg of args) {
        const [argName, argValue] = arg.split("=");
        const prefix = argName.slice(0, 2);

        if (CONFIG_PARSERS[prefix[0]]) {
            config[argName.slice(2)] = CONFIG_PARSERS[prefix[0]](argValue);
        } else {
            const configKey = CONFIG_ALIASES[argName] || argName;
            if (!(configKey in config)) {
                throw new Error(`Unknown parameter: ${argName}`);
            }
            config[configKey] = parseInt(argValue);
        }
    }

    simulation = new sim.Simulation(config);
}

function execTrain(args) {
    if (args.length > 1) {
        throw new Error("This command accepts at most one parameter");
    }

    const generations = args.length === 0 ? 1 : parseInt(args[0]);

    for (let i = 0; i < generations; i++) {
        if (i > 0) {
            terminal.println("");
        }

        const stats = simulation.train();
        terminal.println(stats);
    }
}

function redraw() {
    if (active) {
        const stats = simulation.step();
        if (stats) {
            terminal.println(stats);
        }
    }

    const config = simulation.config();
    const world = simulation.world();

    viewport.clear();
    drawFoods(world.foods, config);
    drawAnimals(world.animals, config);

    requestAnimationFrame(redraw);
}

function drawFoods(foods, config) {
    for (const food of foods) {
        viewport.drawCircle(
            food.x,
            food.y,
            config.food_size / 2.0,
            'rgb(0, 255, 128)'
        );
    }
}

function drawAnimals(animals, config) {
    for (const animal of animals) {
        viewport.drawTriangle(
            animal.x,
            animal.y,
            config.food_size,
            animal.rotation,
            'rgb(255, 255, 255)'
        );
        drawAnimalVision(animal, config);
    }
}

function drawAnimalVision(animal, config) {
    const anglePerCell = config.eye_fov_angle / config.eye_cells;

    for (let cellId = 0; cellId < config.eye_cells; cellId++) {
        const angleFrom = animal.rotation - config.eye_fov_angle / 2.0 + cellId * anglePerCell + Math.PI / 2.0;
        const angleTo = angleFrom + anglePerCell;
        const energy = animal.vision[cellId];

        viewport.drawArc(
            animal.x,
            animal.y,
            config.food_size * 2.5,
            angleFrom,
            angleTo,
            `rgba(0, 255, 128, ${energy})`
        );
    }
}

redraw();