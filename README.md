# rustyWings
## Neural Network Bird Simulation

----
**Simulation of Evolution**

Powered by Neural Networks and Genetic Algorithms, rustyWings simulates a world where triangular birds navigate their environment in search of food represented by circles.

----

**About**

* Each bird has:
    * An eye with a limited field of vision visualized as a circle around the bird.
    * A neural network brain that determines its movement direction and speed.
* The simulation starts with randomly initialized brains for each bird.
* After 2500 turns (approximately 40 seconds), birds with the most food are selected for reproduction. Their offspring forms the next generation.
* Over generations, the birds, through a genetic algorithm, become adept at finding food - it's like they're learning on their own!
* **Note:** This is not the boids algorithm. Bird behavior is not pre-programmed, it's learned over time.

----

**Interaction**

Influence the simulation by entering commands in the input box:

* `train (t)`: Fast-forwards the simulation to observe rapid learning.
* Explore the source code: [https://github.com/mahim37/rustyWings](https://github.com/mahim37/rustyWings)

**Enjoy the simulation!**

----

**Commands**

* `p / pause`: Pauses or resumes the simulation.
* `r / reset [parameter=value ...]`: Restarts the simulation with optional parameters:
    * `a / animals`: Number of birds (default: ${config.world_animals})
    * `f / foods`: Number of food items (default: ${config.world_foods})
    * `n / neurons`: Number of brain neurons per bird (default: ${config.brain_neurons})
    * `p / photoreceptors`: Number of eye cells per bird (default: ${config.eye_cells})
    * Examples:
        * `reset animals=100 foods=100`
        * `r a=100 f=100`
        * `r p=3`
* `(t)rain [generations]`: Fast-forwards one or more generations.
    * Examples:
        * `train`
        * `t 5`

----

**Advanced Tips**

* Modify any parameter within the `reset` command.
    * Examples:
        * `r i:integer_param=123 f:float_param=123`
        * `r a=200 f=200 f:food_size=0.002`
    * Parameter names can be found in the source code.

----

**Interesting Scenarios**

* `r i:ga_reverse=1 f:sim_speed_min=0.003`: Birds avoid food (try to escape?)
* `r i:brain_neurons=1`: Single-neuron "zombie" birds
* `r f:food_size=0.05`: Larger food items
* `r f:eye_fov_angle=0.45`: Birds with a narrow field of view

----

**Note:**

* `${config.world_animals}`, `${config.world_foods}`, `${config.brain_neurons}`, and `${config.eye_cells}` represent default values defined in the code.
