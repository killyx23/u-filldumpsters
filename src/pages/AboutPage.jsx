import React from 'react';
import { Helmet } from 'react-helmet';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Hammer, Truck, Clock, MapPin, ArrowRight } from 'lucide-react';
import BackButton from '@/components/BackButton';
import { Button } from '@/components/ui/button';

const serviceAreas = ['Davis County', 'Utah County', 'Salt Lake County', 'Saratoga Springs'];

const StorySection = ({ icon: Icon, emoji, title, children, delay }) => (
  <motion.section
    initial={{ opacity: 0, y: 24 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ duration: 0.5, delay }}
    className="bg-white/10 backdrop-blur-lg rounded-2xl p-6 sm:p-8 md:p-10 shadow-2xl border border-white/15"
  >
    <div className="flex items-start gap-4 mb-6">
      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-yellow-400/15 border border-yellow-400/40">
        <Icon className="h-6 w-6 text-yellow-400" />
      </div>
      <div>
        <p className="text-sm tracking-wide text-yellow-300/90 mb-1" aria-hidden>
          {emoji}
        </p>
        <h2 className="text-2xl sm:text-3xl font-bold text-yellow-400 leading-snug tracking-tight">
          {title}
        </h2>
      </div>
    </div>
    <div className="space-y-5 text-base sm:text-lg text-blue-100 leading-relaxed tracking-wide">
      {children}
    </div>
  </motion.section>
);

export const AboutPage = () => {
  return (
    <>
      <Helmet>
        <title>About Us - U-Fill Dumpsters</title>
        <meta
          name="description"
          content="Built by DIYers, for DIYers. Learn how U-Fill Dumpsters created a contact-free way to rent compact equipment across the Wasatch Front."
        />
      </Helmet>
      <div className="relative">
        <BackButton className="absolute top-4 left-4 z-20" />
        <motion.div
          initial={{ opacity: 0, y: 28 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55 }}
          className="container mx-auto max-w-4xl py-16 px-4"
        >
          <header className="text-center mb-12 md:mb-16">
            <p className="text-yellow-300/90 text-sm sm:text-base font-semibold uppercase tracking-[0.2em] mb-3">
              Our Story
            </p>
            <h1 className="text-4xl sm:text-5xl font-bold text-yellow-400 mb-4 tracking-tight">
              About Us
            </h1>
            <p className="text-xl sm:text-2xl text-white font-semibold leading-relaxed">
              Built by DIYers, for DIYers
            </p>
            <p className="mt-4 text-blue-200 text-base sm:text-lg max-w-2xl mx-auto leading-relaxed">
              Everyday people. Fair pricing. Compact equipment that actually fits a neighborhood yard.
            </p>
          </header>

          <div className="space-y-8 md:space-y-10">
            <StorySection icon={Hammer} emoji="🛠️" title="Our Story: Built by DIYers, for DIYers" delay={0.1}>
              <p>
                We&apos;ve always been a “do-it-yourself” kind of family. Whether we are tackling a massive
                landscaping project or remodeling a room, our first instinct has always been to figure it out
                ourselves. We don&apos;t live in luxury estates with endless budgets—we are everyday people who
                believe in the power of sweat equity.
              </p>
              <p>
                There is nothing quite like looking back at your own home or yard and saying,{' '}
                <span className="italic text-white font-medium">“I created this.”</span>
              </p>
              <p>
                But along our journey of turning our own little plots of land into places we love, we ran into
                a massive, frustrating hurdle: the tool dilemma. We quickly learned that having the right tool
                is what separates a frustrating weekend from a professional-looking job. However, we didn&apos;t
                want to buy expensive machinery just to have it sit in the garage or basement forever after one
                use.
              </p>
              <p>
                When we turned to traditional rental companies, we found their equipment was built for massive
                commercial construction sites—not a typical neighborhood yard.
              </p>
              <p>
                We were tired of dealing with oversized machines that required a massive commercial truck to
                tow, tore up our lawns, and couldn&apos;t even fit through a standard backyard gate. To make
                matters worse, traditional rentals forced us into restrictive 4-hour windows. By the time you
                hauled the machine home, figured out how to use it, and actually got started, your time was up.
                You were left doing the tight-space labor by hand anyway, or paying exorbitant fees just to keep
                it longer.
              </p>
              <p className="text-white font-semibold">
                We knew there had to be a better, fairer way. So, we built it.
              </p>
            </StorySection>

            <StorySection icon={Truck} emoji="🚜" title="A Smarter Way to Tackle Your Projects" delay={0.18}>
              <p>
                We created our rental service to bridge the gap between heavy-duty power and homeowner reality.
                We source strong, compact equipment and matching attachments that work seamlessly together. Our
                machines give you the muscle to work 100 times faster than using a shovel and pick, without the
                steep learning curve or the risk of destroying your property.
              </p>
              <p>
                To help you truly finish the job, we also provide the specific equipment you need to haul all
                that leftover renovation debris and landscaping material to the dump in one go—saving you
                countless truckloads, hours, and extra fees.
              </p>
            </StorySection>

            <StorySection
              icon={Clock}
              emoji="⏱️"
              title="No Counters. No Hassle. Just More Time to Work."
              delay={0.26}
            >
              <p>
                Because we are everyday people who value time and efficiency, we completely eliminated the
                worst part of renting equipment: standing in line at a counter wasting time on paperwork.
              </p>
              <p>
                We developed a streamlined, completely contact-free online system. You can book what you need
                online in just a few minutes, fill out all your paperwork ahead of time, and choose to keep it
                for as long as your project actually takes.
              </p>
              <p>
                By strategically placing our equipment in centralized pickup locations across the valley and
                eliminating traditional storefront overhead, we pass those massive savings directly down to
                you. When your rental day arrives, you simply drive to the location closest to you, unlock it,
                hitch up your equipment, and go. When you&apos;re done, just drop it back off and lock it up.
                It&apos;s that simple.
              </p>
              <p>
                We&apos;ve also built an advanced online portal packed with tips, tricks, and tutorial videos.
                Whether you are a seasoned pro or operating a machine for the very first time, we give you the
                knowledge to use our equipment safely and with total confidence.
              </p>
            </StorySection>

            <StorySection icon={MapPin} emoji="🏔️" title="Proudly Serving the Wasatch Front" delay={0.34}>
              <p>
                Growing up in Utah, this valley is our home. We operate across Davis County, Utah County, and
                Salt Lake County, with our main roots planted right here in Saratoga Springs.
              </p>
              <ul className="flex flex-wrap gap-2 sm:gap-3 list-none p-0 m-0">
                {serviceAreas.map((area) => (
                  <li
                    key={area}
                    className="rounded-full border border-yellow-400/40 bg-yellow-400/10 px-4 py-2 text-sm sm:text-base font-semibold text-yellow-200 tracking-wide"
                  >
                    {area}
                  </li>
                ))}
              </ul>
              <p>
                Our goal is simple: to give our neighbors the equipment, the fair pricing, and the confidence
                they need to tackle their dream projects without killing their backs or breaking the bank. Let
                us help you save time and money on your next project, while we keep busy working on our own
                ever-growing list of DIY ideas!
              </p>
            </StorySection>
          </div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.42 }}
            className="mt-12 md:mt-16 text-center bg-white/10 backdrop-blur-lg rounded-2xl p-8 sm:p-10 shadow-2xl border border-yellow-400/30"
          >
            <p className="text-xl sm:text-2xl font-bold text-white mb-3 tracking-tight">
              Ready to start your next project?
            </p>
            <p className="text-blue-200 text-base sm:text-lg leading-relaxed mb-8 max-w-xl mx-auto">
              Browse compact equipment built for real yards—not commercial job sites—and book online in minutes.
            </p>
            <Button
              asChild
              className="tap-target bg-yellow-400 text-blue-900 hover:bg-yellow-500 font-bold text-base sm:text-lg px-6 sm:px-8 py-6 h-auto rounded-xl shadow-lg"
            >
              <Link to="/">
                Browse Our Compact Equipment &amp; Book Online Today
                <ArrowRight className="ml-2 h-5 w-5" />
              </Link>
            </Button>
          </motion.div>
        </motion.div>
      </div>
    </>
  );
};

export default AboutPage;
