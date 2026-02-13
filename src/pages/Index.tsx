import { Navigation } from "@/components/Navigation";
import { Hero } from "@/components/Hero";
import { PartnershipBanner } from "@/components/PartnershipBanner";
import { StatsSection } from "@/components/StatsSection";
import { HowItWorks } from "@/components/HowItWorks";
import { ServicesSection } from "@/components/ServicesSection";
import { FundingTypes } from "@/components/FundingTypes";
import { FeaturedProjects } from "@/components/FeaturedProjects";
import { LatestNews } from "@/components/LatestNews";
import { TestimonialsSection } from "@/components/TestimonialsSection";
import { Features } from "@/components/Features";
import { CallToAction } from "@/components/CallToAction";
import { Footer } from "@/components/Footer";
import { WelcomePopup } from "@/components/WelcomePopup";
import { MembershipBanner } from "@/components/MembershipBanner";

const Index = () => {
  return (
    <div className="min-h-screen bg-background">
      <WelcomePopup />
      <Navigation />
      <Hero />
      <div className="py-16 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-accent/5 to-secondary/5" />
        <div className="container mx-auto px-4 relative z-10">
          <div className="grid lg:grid-cols-2 gap-8">
            {/* Left: Membership / Subscription */}
            <MembershipBanner />
            {/* Right: Partnership */}
            <PartnershipBanner />
          </div>
        </div>
      </div>
      <LatestNews />
      <StatsSection />
      <HowItWorks />
      <ServicesSection />
      <FundingTypes />
      <FeaturedProjects />
      <TestimonialsSection />
      <Features />
      <CallToAction />
      <Footer />
    </div>
  );
};

export default Index;
